//go:build !windows

package main

import "syscall"

// detachSysProcAttr returns SysProcAttr that puts the spawned process in a
// new session, so it survives the parent (Thermic) exiting and isn't tied
// to its controlling terminal.
func detachSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setsid: true}
}
