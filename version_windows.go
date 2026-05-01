//go:build windows

package main

import "syscall"

// detachSysProcAttr is a no-op on Windows (AUR upgrade is Linux-only); it
// exists so version.go compiles cross-platform.
func detachSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{}
}
