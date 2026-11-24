package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"unsafe"
)

const (
	notSetUp   = "git: Unimatrix Zero's git isn't set up. Restart Unimatrix Zero, then try again."
	notStarted = "git: Unimatrix Zero's git didn't start. Restart Unimatrix Zero, then try again."
)

func main() {
	os.Exit(run())
}

func run() int {
	s, err := readSettings()
	if err != nil {
		fmt.Fprintln(os.Stderr, notSetUp)
		return 127
	}

	if info, err := os.Stat(s.Program); err != nil || info.IsDir() {
		fmt.Fprintln(os.Stderr, s.NotReady)
		return 127
	}

	cmd := exec.Command(s.Program)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: childCommandLine(s.Program, ownCommandLine()),
	}
	cmd.Env = withSettings(os.Environ(), s)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	// Not signal.Ignore: on Windows that leaves Ctrl+C to the default handler,
	// which ends this process. Caught, it waits for git, which handles it.
	signal.Notify(make(chan os.Signal, 1), os.Interrupt)

	err = cmd.Run()

	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}

	if err != nil {
		fmt.Fprintln(os.Stderr, notStarted)
		return 127
	}

	return 0
}

func ownCommandLine() string {
	p := syscall.GetCommandLine()

	n := 0
	for *(*uint16)(unsafe.Add(unsafe.Pointer(p), n*2)) != 0 {
		n++
	}

	return syscall.UTF16ToString(unsafe.Slice(p, n))
}
