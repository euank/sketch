package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"slices"
	"strings"

	"github.com/richardlehane/crock32"
	"sketch.dev/ant"
	"sketch.dev/dockerimg"
	"sketch.dev/httprr"
	"sketch.dev/loop"
	"sketch.dev/loop/server"
	"sketch.dev/skabandclient"
	"sketch.dev/skribe"
	"sketch.dev/termui"
)

func main() {
	err := run()
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v: %v\n", os.Args[0], err)
		os.Exit(1)
	}
}

func run() error {
	addr := flag.String("addr", "localhost:0", "local debug HTTP server address")
	skabandAddr := flag.String("skaband-addr", "https://sketch.dev", "URL of the skaband server")
	unsafe := flag.Bool("unsafe", false, "run directly without a docker container")
	openBrowser := flag.Bool("open", false, "open sketch URL in system browser")
	httprrFile := flag.String("httprr", "", "if set, record HTTP interactions to file")
	record := flag.Bool("httprecord", true, "Record trace (if httprr is set)")
	maxIterations := flag.Uint64("max-iterations", 0, "maximum number of iterations the agent should perform per turn, 0 to disable limit")
	maxWallTime := flag.Duration("max-wall-time", 0, "maximum time the agent should run per turn, 0 to disable limit")
	maxDollars := flag.Float64("max-dollars", 5.0, "maximum dollars the agent should spend per turn, 0 to disable limit")
	script := flag.Bool("script", false, "run a single iteration and output JSON suitable for scripting")
	sessionID := flag.String("session-id", newSessionID(), "unique session-id for a sketch process")
	gitUsername := flag.String("git-username", "", "username for git commits")
	gitEmail := flag.String("git-email", "", "email for git commits")
	verbose := flag.Bool("verbose", false, "enable verbose output")
	version := flag.Bool("version", false, "print the version and exit")
	noCleanup := flag.Bool("nocleanup", false, "do not clean up docker containers on exit")
	containerLogDest := flag.String("save-container-logs", "", "host path to save container logs to on exit")
	sketchBinaryLinux := flag.String("sketch-binary-linux", "", "path to a pre-built sketch binary for linux")
	workingDir := flag.String("C", "", "when set, change to this directory before running")
	flag.Parse()

	if *version {
		bi, ok := debug.ReadBuildInfo()
		if ok {
			fmt.Printf("%s@%v\n", bi.Path, bi.Main.Version)
		}
		return nil
	}

	firstMessage := flag.Args()

	// Add a global "session_id" to all logs using this context.
	// A "session" is a single full run of the agent.
	ctx := skribe.ContextWithAttr(context.Background(), slog.String("session_id", *sessionID))

	var slogHandler slog.Handler
	var err error
	var logFile *os.File
	if !*script {
		// Log to a file
		logFile, err = os.CreateTemp("", "sketch-cli-log-*")
		if err != nil {
			return fmt.Errorf("cannot create log file: %v", err)
		}
		fmt.Printf("structured logs: %v\n", logFile.Name())
		defer logFile.Close()
		slogHandler = slog.NewJSONHandler(logFile, &slog.HandlerOptions{Level: slog.LevelDebug})
		slogHandler = skribe.AttrsWrap(slogHandler)
	} else {
		// In script mode, we don't want any logging output to interfere with JSON
		// Use DiscardHandler to completely discard all logs
		slogHandler = slog.DiscardHandler
	}
	slog.SetDefault(slog.New(slogHandler))

	if *workingDir != "" {
		if err := os.Chdir(*workingDir); err != nil {
			return fmt.Errorf("sketch: cannot change directory to %q: %v", *workingDir, err)
		}
	}

	if *gitUsername == "" {
		*gitUsername = defaultGitUsername()
	}
	if *gitEmail == "" {
		*gitEmail = defaultGitEmail()
	}

	inDocker := false
	if _, err := os.Stat("/.dockerenv"); err == nil {
		inDocker = true
	}

	if !inDocker {
		msgs, err := hostReqsCheck()
		if *verbose {
			fmt.Println("Host requirement checks:")
			for _, m := range msgs {
				fmt.Println(m)
			}
		}
		if err != nil {
			return err
		}
	}

	if *script && len(firstMessage) == 0 {
		return fmt.Errorf("-script flag requires a message to send to the agent")
	}

	var pubKey, antURL, apiKey string
	if *skabandAddr == "" {
		apiKey = os.Getenv("ANTHROPIC_API_KEY")
		if apiKey == "" {
			return fmt.Errorf("ANTHROPIC_API_KEY environment variable is not set")
		}
	} else {
		if inDocker {
			apiKey = os.Getenv("ANTHROPIC_API_KEY")
			pubKey = os.Getenv("SKETCH_PUB_KEY")
			antURL, err = skabandclient.LocalhostToDockerInternal(os.Getenv("ANT_URL"))
			if err != nil {
				return err
			}
		} else {
			privKey, err := skabandclient.LoadOrCreatePrivateKey(skabandclient.DefaultKeyPath())
			if err != nil {
				return err
			}
			pubKey, antURL, apiKey, err = skabandclient.Login(os.Stdout, privKey, *skabandAddr, *sessionID)
			if err != nil {
				return err
			}
		}
	}

	if !*unsafe {
		cwd, err := os.Getwd()
		if err != nil {
			return fmt.Errorf("sketch: cannot determine current working directory: %v", err)
		}
		// TODO: this is a bit of a mess.
		// The "stdout" and "stderr" used here are "just" for verbose logs from LaunchContainer.
		// LaunchContainer has to attach the termui, and does that directly to os.Stdout/os.Stderr
		// regardless of what is attached here.
		// This is probably wrong. Instead of having a big "if verbose" switch here, the verbosity
		// switches should be inside LaunchContainer and os.Stdout/os.Stderr should be passed in
		// here (with the parameters being kept for future testing).
		var stdout, stderr io.Writer
		var outbuf, errbuf *bytes.Buffer
		if *verbose {
			stdout, stderr = os.Stdout, os.Stderr
		} else {
			outbuf, errbuf = &bytes.Buffer{}, &bytes.Buffer{}
			stdout, stderr = outbuf, errbuf
		}
		fmt.Printf("launching container...\n")
		config := dockerimg.ContainerConfig{
			SessionID:         *sessionID,
			LocalAddr:         *addr,
			SkabandAddr:       *skabandAddr,
			AntURL:            antURL,
			AntAPIKey:         apiKey,
			Path:              cwd,
			GitUsername:       *gitUsername,
			GitEmail:          *gitEmail,
			OpenBrowser:       *openBrowser,
			NoCleanup:         *noCleanup,
			ContainerLogDest:  *containerLogDest,
			SketchBinaryLinux: *sketchBinaryLinux,
			SketchPubKey:      pubKey,
			ForceRebuild:      false,
		}
		if err := dockerimg.LaunchContainer(ctx, stdout, stderr, config); err != nil {
			if *verbose {
				fmt.Fprintf(os.Stderr, "dockerimg.LaunchContainer failed: %v\ndockerimg.LaunchContainer stderr:\n%s\ndockerimg.LaunchContainer stdout:\n%s\n", err, errbuf.String(), outbuf.String())
			}
			return err
		}
		return nil
	}

	var client *http.Client
	if *httprrFile != "" {
		var err error
		var rr *httprr.RecordReplay
		if *record {
			rr, err = httprr.OpenForRecording(*httprrFile, http.DefaultTransport)
		} else {
			rr, err = httprr.Open(*httprrFile, http.DefaultTransport)
		}
		if err != nil {
			return fmt.Errorf("httprr: %v", err)
		}
		// Scrub API keys from requests for security
		rr.ScrubReq(func(req *http.Request) error {
			req.Header.Del("x-api-key")
			req.Header.Del("anthropic-api-key")
			return nil
		})
		client = rr.Client()
	}
	wd, err := os.Getwd()
	if err != nil {
		return err
	}

	agentConfig := loop.AgentConfig{
		Context:          ctx,
		AntURL:           antURL,
		APIKey:           apiKey,
		HTTPC:            client,
		Budget:           ant.Budget{MaxResponses: *maxIterations, MaxWallTime: *maxWallTime, MaxDollars: *maxDollars},
		GitUsername:      *gitUsername,
		GitEmail:         *gitEmail,
		SessionID:        *sessionID,
		ClientGOOS:       runtime.GOOS,
		ClientGOARCH:     runtime.GOARCH,
		UseAnthropicEdit: os.Getenv("SKETCH_ANTHROPIC_EDIT") == "1",
	}
	agent := loop.NewAgent(agentConfig)

	srv, err := server.New(agent, logFile)
	if err != nil {
		return err
	}

	if !inDocker {
		ini := loop.AgentInit{
			WorkingDir: wd,
		}
		if err = agent.Init(ini); err != nil {
			return fmt.Errorf("failed to initialize agent: %v", err)
		}
	}

	// Start the agent
	go agent.Loop(ctx)

	// Start the local HTTP server.
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		return fmt.Errorf("cannot create debug server listener: %v", err)
	}
	go (&http.Server{Handler: srv}).Serve(ln)
	var ps1URL string
	if *skabandAddr != "" {
		ps1URL = fmt.Sprintf("%s/s/%s", *skabandAddr, *sessionID)
	} else if !inDocker {
		// Do not tell users about the port inside the container, let the
		// process running on the host report this.
		ps1URL = fmt.Sprintf("http://%s", ln.Addr())
	}

	if len(firstMessage) > 0 {
		agent.UserMessage(ctx, strings.Join(firstMessage, " "))
	}

	if inDocker {
		<-agent.Ready()
		if ps1URL == "" {
			ps1URL = agent.URL()
		}
	}

	// Open the debug URL in the system browser if requested
	if *openBrowser {
		dockerimg.OpenBrowser(ctx, ps1URL)
	}

	// Create the termui instance
	s := termui.New(agent, ps1URL)
	defer func() {
		r := recover()
		if err := s.RestoreOldState(); err != nil {
			fmt.Fprintf(os.Stderr, "couldn't restore old terminal state: %s\n", err)
		}
		if r != nil {
			panic(r)
		}
	}()

	// Start skaband connection loop if needed
	if *skabandAddr != "" {
		connectFn := func(connected bool) {
			if connected {
				s.AppendSystemMessage("skaband connected")
			} else {
				s.AppendSystemMessage("skaband disconnected")
			}
		}
		go skabandclient.DialAndServeLoop(ctx, *skabandAddr, *sessionID, pubKey, srv, connectFn)
	}

	if *script {
		var branchesCreated []string
		var commits []*loop.GitCommit

		for {
			m := agent.WaitForMessage(ctx)

			// Track any branches that were created
			if m.Commits != nil {
				for _, commit := range m.Commits {
					if commit.PushedBranch != "" && !slices.Contains(branchesCreated, commit.PushedBranch) {
						branchesCreated = append(branchesCreated, commit.PushedBranch)
					}
					commits = append(commits, commit)
				}
			}

			if m.EndOfTurn && m.ParentConversationID == nil {
				// Create the JSON output with all relevant information
				result := map[string]any{
					"budget":           agent.TotalUsage(),
					"initial_commit":   agent.InitialCommit(),
					"branches_created": branchesCreated,
					"commits":          commits,
					"session_id":       *sessionID,
				}

				jsonOutput, err := json.MarshalIndent(result, "", "  ")
				if err != nil {
					return fmt.Errorf("failed to marshal JSON output: %v", err)
				}

				fmt.Println(string(jsonOutput))
				return nil
			}
		}
	}

	if err := s.Run(ctx); err != nil {
		return err
	}

	return nil
}

// newSessionID generates a new 10-byte random Session ID.
func newSessionID() string {
	u1, u2 := rand.Uint64(), rand.Uint64N(1<<16)
	s := crock32.Encode(u1) + crock32.Encode(uint64(u2))
	if len(s) < 16 {
		s += strings.Repeat("0", 16-len(s))
	}
	return s[0:4] + "-" + s[4:8] + "-" + s[8:12] + "-" + s[12:16]
}

func defaultGitUsername() string {
	out, err := exec.Command("git", "config", "user.name").CombinedOutput()
	if err != nil {
		return "Sketch🕴️" // TODO: what should this be?
	}
	return strings.TrimSpace(string(out))
}

func defaultGitEmail() string {
	out, err := exec.Command("git", "config", "user.email").CombinedOutput()
	if err != nil {
		return "skallywag@sketch.dev" // TODO: what should this be?
	}
	return strings.TrimSpace(string(out))
}
