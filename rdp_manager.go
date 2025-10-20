package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net"
	"sync"
	"time"

	"github.com/tomatome/grdp/core"
	"github.com/tomatome/grdp/glog"
	"github.com/tomatome/grdp/protocol/nla"
	"github.com/tomatome/grdp/protocol/pdu"
	"github.com/tomatome/grdp/protocol/sec"
	"github.com/tomatome/grdp/protocol/t125"
	"github.com/tomatome/grdp/protocol/tpkt"
	"github.com/tomatome/grdp/protocol/x224"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// CreateRDPSession creates a new RDP connection and session
func (a *App) CreateRDPSession(sessionID string, config *RDPConfig) (*RDPSession, error) {
	return a.CreateRDPSessionWithSize(sessionID, config, config.Width, config.Height)
}

// CreateRDPSessionWithSize creates a new RDP connection with specified dimensions
func (a *App) CreateRDPSessionWithSize(sessionID string, config *RDPConfig, width, height int) (*RDPSession, error) {
	// Validate configuration
	if config.Host == "" {
		return nil, fmt.Errorf("RDP host cannot be empty")
	}
	if config.Username == "" {
		return nil, fmt.Errorf("RDP username cannot be empty")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return nil, fmt.Errorf("RDP port must be between 1 and 65535")
	}

	// Validate screen dimensions
	if width <= 0 || height <= 0 {
		width, height = 1024, 768 // fallback to default
	}

	// Set grdp logging level
	glog.SetLevel(glog.INFO)

	// Start connection flow with status messages
	displayTarget := fmt.Sprintf("%s@%s:%d (RDP)", config.Username, config.Host, config.Port)
	if config.Domain != "" {
		displayTarget = fmt.Sprintf("%s\\%s@%s:%d (RDP)", config.Domain, config.Username, config.Host, config.Port)
	}

	a.messages.StartConnectionFlow(sessionID, displayTarget, []string{"RDP Protocol", "Authenticating"})

	fmt.Printf("RDP: Connecting to %s:%d as %s (domain: %s)\n", config.Host, config.Port, config.Username, config.Domain)

	// Create TCP connection
	target := fmt.Sprintf("%s:%d", config.Host, config.Port)
	conn, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		a.messages.ConnectionFailed(sessionID, fmt.Errorf("failed to connect to %s: %w", target, err))
		return nil, fmt.Errorf("failed to connect to %s: %w", target, err)
	}

	// Build grdp protocol stack (following the example from grdp/example/rdp.go)
	ntlm := nla.NewNTLMv2(config.Domain, config.Username, config.Password)
	tpktLayer := tpkt.New(core.NewSocketLayer(conn), ntlm)
	x224Layer := x224.New(tpktLayer)
	mcsLayer := t125.NewMCSClient(x224Layer)
	secLayer := sec.NewClient(mcsLayer)
	pduLayer := pdu.NewClient(secLayer)

	// Configure client settings
	mcsLayer.SetClientCoreData(uint16(width), uint16(height))
	secLayer.SetUser(config.Username)
	secLayer.SetPwd(config.Password)
	secLayer.SetDomain(config.Domain)

	// Set up protocol layer listeners
	tpktLayer.SetFastPathListener(secLayer)
	secLayer.SetFastPathListener(pduLayer)
	secLayer.SetChannelSender(mcsLayer)

	// Use SSL/TLS for secure connection
	x224Layer.SetRequestedProtocol(x224.PROTOCOL_SSL)

	// Create RDP session wrapper
	rdpSession := &RDPSession{
		sessionID: sessionID,
		width:     width,
		height:    height,
		cleaning:  false,
		done:      make(chan bool),
		closed:    make(chan bool),
		conn:      conn,
		pdu:       pduLayer,
	}

	// Set up event handlers for RDP connection
	pduLayer.On("error", func(e error) {
		fmt.Printf("RDP error for session %s: %v\n", sessionID, e)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "rdp-error", map[string]interface{}{
				"sessionId": sessionID,
				"error":     e.Error(),
			})
		}
	})

	pduLayer.On("close", func() {
		fmt.Printf("RDP connection closed for session %s\n", sessionID)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "rdp-closed", map[string]interface{}{
				"sessionId": sessionID,
			})
		}
	})

	pduLayer.On("success", func() {
		fmt.Printf("RDP connection successful for session %s\n", sessionID)
	})

	pduLayer.On("ready", func() {
		fmt.Printf("RDP session ready for session %s\n", sessionID)
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "rdp-ready", map[string]interface{}{
				"sessionId": sessionID,
			})
		}
	})

	// Set up bitmap update handler
	pduLayer.On("bitmap", func(rectangles []pdu.BitmapData) {
		fmt.Printf("RDP bitmap update for session %s: %d rectangles\n", sessionID, len(rectangles))

		// Process each bitmap rectangle
		for _, rect := range rectangles {
			// Get bitmap data
			bitmapData := rect.BitmapDataStream
			isCompressed := rect.IsCompress()

			// Decompress if needed
			if isCompressed {
				bitmapData = core.Decompress(
					rect.BitmapDataStream,
					int(rect.Width),
					int(rect.Height),
					int(rect.BitsPerPixel),
				)
			}

			// Send bitmap to frontend
			a.handleRDPBitmap(
				sessionID,
				int(rect.DestLeft),
				int(rect.DestTop),
				int(rect.Width),
				int(rect.Height),
				bitmapData,
				int(rect.BitsPerPixel),
			)
		}
	})

	// Connect to RDP server
	fmt.Printf("RDP: Initiating X224 connection for session %s\n", sessionID)
	if err := x224Layer.Connect(); err != nil {
		conn.Close()
		a.messages.ConnectionFailed(sessionID, err)
		return nil, fmt.Errorf("RDP connection failed: %w", err)
	}

	// Connection successful - update status
	a.messages.SessionReady(sessionID)
	fmt.Printf("RDP session created successfully for %s\n", sessionID)
	return rdpSession, nil
}

// handleRDPBitmap processes bitmap updates from RDP server and sends to frontend
func (a *App) handleRDPBitmap(sessionID string, x, y, width, height int, bitmapData []byte, bpp int) {
	// Convert raw bitmap data to PNG for web transmission
	imageData, err := a.convertBitmapToPNG(bitmapData, width, height, bpp)
	if err != nil {
		fmt.Printf("Error converting bitmap to PNG for session %s: %v\n", sessionID, err)
		return
	}

	// Encode to base64
	base64Image := base64.StdEncoding.EncodeToString(imageData)

	// Emit bitmap update event to frontend
	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "rdp-bitmap-update", map[string]interface{}{
			"sessionId": sessionID,
			"x":         x,
			"y":         y,
			"width":     width,
			"height":    height,
			"imageData": base64Image,
		})
	}
}

// convertBitmapToPNG converts raw bitmap data to PNG format
func (a *App) convertBitmapToPNG(data []byte, width, height, bpp int) ([]byte, error) {
	// Create a new RGBA image
	img := image.NewRGBA(image.Rect(0, 0, width, height))

	// Convert bitmap data based on color depth
	switch bpp {
	case 16:
		// 16-bit RGB565 format
		a.decodeBitmap16(data, img, width, height)
	case 24:
		// 24-bit RGB format
		a.decodeBitmap24(data, img, width, height)
	case 32:
		// 32-bit RGBA format
		a.decodeBitmap32(data, img, width, height)
	default:
		return nil, fmt.Errorf("unsupported color depth: %d", bpp)
	}

	// Encode image to PNG
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("failed to encode PNG: %w", err)
	}

	return buf.Bytes(), nil
}

// decodeBitmap16 decodes 16-bit RGB565 bitmap data
func (a *App) decodeBitmap16(data []byte, img *image.RGBA, width, height int) {
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			offset := (y*width + x) * 2
			if offset+1 >= len(data) {
				continue
			}

			// RGB565: RRRRRGGG GGGBBBBB
			pixel := uint16(data[offset]) | (uint16(data[offset+1]) << 8)
			r := uint8((pixel>>11)&0x1F) << 3
			g := uint8((pixel>>5)&0x3F) << 2
			b := uint8(pixel&0x1F) << 3

			img.Set(x, y, color.RGBA{R: r, G: g, B: b, A: 255})
		}
	}
}

// decodeBitmap24 decodes 24-bit RGB bitmap data
func (a *App) decodeBitmap24(data []byte, img *image.RGBA, width, height int) {
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			offset := (y*width + x) * 3
			if offset+2 >= len(data) {
				continue
			}

			b := data[offset]
			g := data[offset+1]
			r := data[offset+2]

			img.Set(x, y, color.RGBA{R: r, G: g, B: b, A: 255})
		}
	}
}

// decodeBitmap32 decodes 32-bit RGBA bitmap data
func (a *App) decodeBitmap32(data []byte, img *image.RGBA, width, height int) {
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			offset := (y*width + x) * 4
			if offset+3 >= len(data) {
				continue
			}

			b := data[offset]
			g := data[offset+1]
			r := data[offset+2]
			a := data[offset+3]

			img.Set(x, y, color.RGBA{R: r, G: g, B: b, A: a})
		}
	}
}

// ResizeRDPSession resizes an RDP session
func (a *App) ResizeRDPSession(sessionID string, width, height int) error {
	a.rdp.rdpSessionsMutex.RLock()
	session, exists := a.rdp.rdpSessions[sessionID]
	a.rdp.rdpSessionsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("RDP session %s not found", sessionID)
	}

	if session.IsCleaning() {
		return fmt.Errorf("RDP session is being cleaned up")
	}

	session.mu.Lock()
	session.width = width
	session.height = height
	session.mu.Unlock()

	// TODO: Phase 2 - Send resize command to RDP server
	// This would involve sending RDP protocol messages to change the desktop size
	fmt.Printf("RDP session %s resized to %dx%d (placeholder)\n", sessionID, width, height)

	return nil
}

// CloseRDPSession closes an RDP session
func (a *App) CloseRDPSession(sessionID string) error {
	a.rdp.rdpSessionsMutex.Lock()
	session, exists := a.rdp.rdpSessions[sessionID]
	if exists {
		delete(a.rdp.rdpSessions, sessionID)
	}
	a.rdp.rdpSessionsMutex.Unlock()

	if !exists {
		return fmt.Errorf("RDP session %s not found", sessionID)
	}

	if session.IsCleaning() {
		return nil
	}

	session.SetCleaning(true)

	// Close the network connection
	if session.conn != nil {
		if conn, ok := session.conn.(net.Conn); ok {
			conn.Close()
		}
	}

	// Close channels
	go func() {
		if session.done != nil {
			close(session.done)
		}
		if session.closed != nil {
			close(session.closed)
		}
	}()

	fmt.Printf("RDP session %s closed\n", sessionID)

	return nil
}

// Close implements the Cleanup interface for RDPManager
func (rm *RDPManager) Close() error {
	rm.rdpSessionsMutex.Lock()
	defer rm.rdpSessionsMutex.Unlock()

	// Close all active RDP sessions
	var wg sync.WaitGroup
	for sessionID, session := range rm.rdpSessions {
		wg.Add(1)
		go func(sid string, s *RDPSession) {
			defer wg.Done()
			s.SetCleaning(true)

			// Close network connection
			if s.conn != nil {
				if conn, ok := s.conn.(net.Conn); ok {
					conn.Close()
				}
			}

			fmt.Printf("Closing RDP session: %s\n", sid)
		}(sessionID, session)
	}

	wg.Wait()

	// Clear the sessions map
	rm.rdpSessions = make(map[string]*RDPSession)

	return nil
}

// ================================================================================
// TODO: Phase 3 - Input Handling (Mouse/Keyboard)
// ================================================================================

// SendRDPMouseEvent sends a mouse event to the RDP session
func (a *App) SendRDPMouseEvent(sessionID string, x, y int, button int, pressed bool) error {
	a.rdp.rdpSessionsMutex.RLock()
	session, exists := a.rdp.rdpSessions[sessionID]
	a.rdp.rdpSessionsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("RDP session %s not found", sessionID)
	}

	if session.IsCleaning() {
		return fmt.Errorf("RDP session is being cleaned up")
	}

	// Get PDU client
	pduClient, ok := session.pdu.(*pdu.Client)
	if !ok || pduClient == nil {
		return fmt.Errorf("RDP PDU client not available")
	}

	// Create pointer event
	pointerEvent := &pdu.PointerEvent{
		XPos: uint16(x),
		YPos: uint16(y),
	}

	// Set button flags based on button and pressed state
	if pressed {
		pointerEvent.PointerFlags |= pdu.PTRFLAGS_DOWN
	}

	switch button {
	case 1: // Left button
		pointerEvent.PointerFlags |= pdu.PTRFLAGS_BUTTON1
	case 2: // Right button
		pointerEvent.PointerFlags |= pdu.PTRFLAGS_BUTTON2
	case 3: // Middle button
		pointerEvent.PointerFlags |= pdu.PTRFLAGS_BUTTON3
	default:
		pointerEvent.PointerFlags |= pdu.PTRFLAGS_MOVE
	}

	// Send mouse event
	pduClient.SendInputEvents(pdu.INPUT_EVENT_MOUSE, []pdu.InputEventsInterface{pointerEvent})

	return nil
}

// SendRDPKeyEvent sends a keyboard event to the RDP session
func (a *App) SendRDPKeyEvent(sessionID string, keyCode int, pressed bool) error {
	a.rdp.rdpSessionsMutex.RLock()
	session, exists := a.rdp.rdpSessions[sessionID]
	a.rdp.rdpSessionsMutex.RUnlock()

	if !exists {
		return fmt.Errorf("RDP session %s not found", sessionID)
	}

	if session.IsCleaning() {
		return fmt.Errorf("RDP session is being cleaned up")
	}

	// Get PDU client
	pduClient, ok := session.pdu.(*pdu.Client)
	if !ok || pduClient == nil {
		return fmt.Errorf("RDP PDU client not available")
	}

	// Create scancode key event
	keyEvent := &pdu.ScancodeKeyEvent{
		KeyCode: uint16(keyCode),
	}

	// Set release flag if not pressed
	if !pressed {
		keyEvent.KeyboardFlags |= pdu.KBDFLAGS_RELEASE
	}

	// Send keyboard event
	pduClient.SendInputEvents(pdu.INPUT_EVENT_SCANCODE, []pdu.InputEventsInterface{keyEvent})

	return nil
}

// ================================================================================
// TODO: Phase 4 - Clipboard Synchronization
// ================================================================================

// SyncRDPClipboard synchronizes clipboard data with RDP session
func (a *App) SyncRDPClipboard(sessionID string, clipboardData string) error {
	// TODO: Phase 4 - Implement clipboard sync
	// This will send clipboard data to/from the RDP server
	// Supports text clipboard only initially
	fmt.Printf("RDP clipboard sync for %s (placeholder - Phase 4)\n", sessionID)
	return nil
}

// ================================================================================
// TODO: Phase 5 - Audio Redirection
// ================================================================================

// EnableRDPAudio enables audio redirection for RDP session
func (a *App) EnableRDPAudio(sessionID string, enabled bool) error {
	// TODO: Phase 5 - Implement audio redirection
	// This will enable/disable audio channel in RDP connection
	fmt.Printf("RDP audio redirection for %s: enabled=%v (placeholder - Phase 5)\n",
		sessionID, enabled)
	return nil
}

// ================================================================================
// TODO: Phase 6 - File Transfer (RemoteFX)
// ================================================================================

// TransferRDPFile transfers a file to/from RDP session
func (a *App) TransferRDPFile(sessionID string, localPath string, remotePath string, upload bool) error {
	// TODO: Phase 6 - Implement file transfer via RDP
	// This will use RDP file transfer capabilities (clipboard or drive redirection)
	fmt.Printf("RDP file transfer for %s: %s -> %s (upload=%v) (placeholder - Phase 6)\n",
		sessionID, localPath, remotePath, upload)
	return nil
}

// ================================================================================
// Utility Functions
// ================================================================================

// GetRDPSessionInfo returns information about an RDP session
func (a *App) GetRDPSessionInfo(sessionID string) (map[string]interface{}, error) {
	a.rdp.rdpSessionsMutex.RLock()
	session, exists := a.rdp.rdpSessions[sessionID]
	a.rdp.rdpSessionsMutex.RUnlock()

	if !exists {
		return nil, fmt.Errorf("RDP session %s not found", sessionID)
	}

	session.mu.RLock()
	defer session.mu.RUnlock()

	return map[string]interface{}{
		"sessionId": session.sessionID,
		"width":     session.width,
		"height":    session.height,
		"cleaning":  session.cleaning,
	}, nil
}

// Note: The actual grdp integration imports are included at the top but not
// fully utilized yet. This allows the code to compile while we build out
// the infrastructure. Full grdp implementation will be added in subsequent phases.
// The imports will be used when implementing the actual RDP protocol connection.
