package server

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"syscall"
	"unsafe"

	"github.com/creack/pty"
	"github.com/gliderlabs/ssh"
)

func setWinsize(f *os.File, w, h int) {
	syscall.Syscall(syscall.SYS_IOCTL, f.Fd(), uintptr(syscall.TIOCSWINSZ),
		uintptr(unsafe.Pointer(&struct{ h, w, x, y uint16 }{uint16(h), uint16(w), 0, 0})))
}

func (s *Server) ServeSSH(ctx context.Context, hostKey, authorizedKeys []byte) error {
	allowed, _, _, _, err := ssh.ParseAuthorizedKey(authorizedKeys)
	if err != nil {
		return fmt.Errorf("ServeSSH: couldn't parse authorized keys: %w", err)
	}
	return ssh.ListenAndServe(":2022",
		func(s ssh.Session) {
			handleSessionfunc(ctx, s)
		},
		ssh.HostKeyPEM(hostKey),
		ssh.PublicKeyAuth(func(ctx ssh.Context, key ssh.PublicKey) bool {
			return ssh.KeysEqual(key, allowed)
		}),
	)
}

func handleSessionfunc(ctx context.Context, s ssh.Session) {
	cmd := exec.CommandContext(ctx, "/bin/bash")
	ptyReq, winCh, isPty := s.Pty()
	if isPty {
		cmd.Env = append(cmd.Env, fmt.Sprintf("TERM=%s", ptyReq.Term))
		f, err := pty.Start(cmd)
		if err != nil {
			panic(err)
		}
		go func() {
			for win := range winCh {
				setWinsize(f, win.Width, win.Height)
			}
		}()
		go func() {
			io.Copy(f, s) // stdin
		}()
		io.Copy(s, f) // stdout
		cmd.Wait()
	} else {
		io.WriteString(s, "No PTY requested.\n")
		s.Exit(1)
	}
}
