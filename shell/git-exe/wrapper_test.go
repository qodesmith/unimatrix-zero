package main

import (
	"slices"
	"testing"
)

func TestParseSettings(t *testing.T) {
	s, err := parseSettings([]byte(`{
		"program": "C:\\git\\cmd\\git.exe",
		"notReady": "git: not ready yet",
		"environment": {"GIT_TERMINAL_PROMPT": "0"},
		"config": [{"key": "credential.helper", "value": "!f() { :; }; f"}]
	}`))
	if err != nil {
		t.Fatal(err)
	}

	if s.Program != `C:\git\cmd\git.exe` || s.NotReady != "git: not ready yet" {
		t.Errorf("got %+v", s)
	}

	if s.Environment["GIT_TERMINAL_PROMPT"] != "0" {
		t.Errorf("environment: got %v", s.Environment)
	}

	if !slices.Equal(s.Config, []setting{{"credential.helper", "!f() { :; }; f"}}) {
		t.Errorf("config: got %v", s.Config)
	}
}

func TestParseSettingsRefuses(t *testing.T) {
	for _, data := range []string{
		``,
		`{`,
		`[]`,
		`{"notReady": "x"}`,
		`{"program": "C:\\git.exe"}`,
		`{"program": 1, "notReady": "x"}`,
	} {
		if _, err := parseSettings([]byte(data)); err == nil {
			t.Errorf("%q: no error", data)
		}
	}
}

func TestAfterProgramName(t *testing.T) {
	for _, c := range []struct{ commandLine, want string }{
		{`git`, ``},
		{`git status`, ` status`},
		{"git\tstatus", "\tstatus"},
		{`git  log  HEAD^`, `  log  HEAD^`},
		{`"C:\Program Files\x\git.exe" log HEAD^`, ` log HEAD^`},
		{`"C:\Program Files\x\git.exe"`, ``},
		{`"C:\a b\git.exe`, ``},
		{`"git"log`, `log`},
		{`C:\x\git.exe log "a b" 'c&d' x^^y 50%PATH%x a|b`, ` log "a b" 'c&d' x^^y 50%PATH%x a|b`},
		{`git.exe commit -m "say \"hi\""`, ` commit -m "say \"hi\""`},
	} {
		if got := afterProgramName(c.commandLine); got != c.want {
			t.Errorf("%q: got %q, want %q", c.commandLine, got, c.want)
		}
	}
}

func TestChildCommandLine(t *testing.T) {
	got := childCommandLine(`C:\Users\me\AppData\Roaming\Unimatrix Zero\git.exe`, `git rev-parse HEAD^ "a b"`)
	want := `"C:\Users\me\AppData\Roaming\Unimatrix Zero\git.exe" rev-parse HEAD^ "a b"`

	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

var noLogin = settings{
	Program:     `C:\git.exe`,
	NotReady:    "not ready",
	Environment: map[string]string{"GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "never"},
	Config:      []setting{{"credential.helper", "helper"}},
}

func TestWithSettings(t *testing.T) {
	got := withSettings([]string{"=C:=C:\\work", "Path=C:\\Windows"}, noLogin)
	want := []string{
		"=C:=C:\\work",
		"Path=C:\\Windows",
		"GCM_INTERACTIVE=never",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_KEY_0=credential.helper",
		"GIT_CONFIG_VALUE_0=helper",
		"GIT_CONFIG_COUNT=1",
	}

	if !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestWithSettingsReplacesWithoutCase(t *testing.T) {
	got := withSettings([]string{"gcm_interactive=always", "Git_Terminal_Prompt=1"}, noLogin)
	want := []string{
		"GCM_INTERACTIVE=never",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_KEY_0=credential.helper",
		"GIT_CONFIG_VALUE_0=helper",
		"GIT_CONFIG_COUNT=1",
	}

	if !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestWithSettingsAfterExistingConfig(t *testing.T) {
	two := noLogin
	two.Config = []setting{{"a.b", "1"}, {"c.d", "2"}}

	got := withSettings([]string{
		"git_config_count=1",
		"GIT_CONFIG_KEY_0=x.y",
		"GIT_CONFIG_VALUE_0=z",
	}, two)

	want := []string{
		"GIT_CONFIG_KEY_0=x.y",
		"GIT_CONFIG_VALUE_0=z",
		"GCM_INTERACTIVE=never",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_KEY_1=a.b",
		"GIT_CONFIG_VALUE_1=1",
		"GIT_CONFIG_KEY_2=c.d",
		"GIT_CONFIG_VALUE_2=2",
		"GIT_CONFIG_COUNT=3",
	}

	if !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestWithSettingsBadCountStartsAtZero(t *testing.T) {
	for _, count := range []string{"", "x", "-2"} {
		got := withSettings([]string{"GIT_CONFIG_COUNT=" + count}, noLogin)

		if !slices.Contains(got, "GIT_CONFIG_KEY_0=credential.helper") || !slices.Contains(got, "GIT_CONFIG_COUNT=1") {
			t.Errorf("%q: got %q", count, got)
		}
	}
}

func TestWithSettingsNoConfigLeavesCount(t *testing.T) {
	none := noLogin
	none.Config = nil

	got := withSettings([]string{"GIT_CONFIG_COUNT=x"}, none)

	if !slices.Contains(got, "GIT_CONFIG_COUNT=x") {
		t.Errorf("got %q", got)
	}
}
