package main

import (
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

type setting struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

type settings struct {
	Program     string            `json:"program"`
	NotReady    string            `json:"notReady"`
	Environment map[string]string `json:"environment"`
	Config      []setting         `json:"config"`
}

func readSettings() (settings, error) {
	exe, err := os.Executable()
	if err != nil {
		return settings{}, err
	}

	data, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "git-wrapper.json"))
	if err != nil {
		return settings{}, err
	}

	return parseSettings(data)
}

func parseSettings(data []byte) (settings, error) {
	var s settings
	if err := json.Unmarshal(data, &s); err != nil {
		return settings{}, err
	}

	if s.Program == "" || s.NotReady == "" {
		return settings{}, errors.New("program and notReady are required")
	}

	return s, nil
}

// childCommandLine keeps the arguments exactly as typed, as Git for Windows'
// own git.exe does: splitting and quoting them again could change one.
func childCommandLine(program, commandLine string) string {
	return `"` + program + `"` + afterProgramName(commandLine)
}

// afterProgramName follows Windows' rule for the first token only: quoted, it
// ends at the next quote; unquoted, at the first space or tab.
func afterProgramName(commandLine string) string {
	if rest, quoted := strings.CutPrefix(commandLine, `"`); quoted {
		_, after, _ := strings.Cut(rest, `"`)
		return after
	}

	if i := strings.IndexAny(commandLine, " \t"); i >= 0 {
		return commandLine[i:]
	}

	return ""
}

// withSettings matches names without case, as Windows does.
func withSettings(env []string, s settings) []string {
	for _, name := range slices.Sorted(maps.Keys(s.Environment)) {
		env = setVariable(env, name, s.Environment[name])
	}

	if len(s.Config) == 0 {
		return env
	}

	count, err := strconv.Atoi(variable(env, "GIT_CONFIG_COUNT"))
	if err != nil || count < 0 {
		count = 0
	}

	for i, c := range s.Config {
		n := strconv.Itoa(count + i)
		env = setVariable(env, "GIT_CONFIG_KEY_"+n, c.Key)
		env = setVariable(env, "GIT_CONFIG_VALUE_"+n, c.Value)
	}

	return setVariable(env, "GIT_CONFIG_COUNT", strconv.Itoa(count+len(s.Config)))
}

func variable(env []string, name string) string {
	for _, entry := range env {
		if found := nameOf(entry); strings.EqualFold(found, name) {
			return entry[min(len(found)+1, len(entry)):]
		}
	}

	return ""
}

func setVariable(env []string, name, value string) []string {
	env = slices.DeleteFunc(env, func(entry string) bool {
		return strings.EqualFold(nameOf(entry), name)
	})

	return append(env, name+"="+value)
}

// nameOf allows a leading "=": Windows keeps each drive's folder in a
// variable such as "=C:".
func nameOf(entry string) string {
	if entry == "" {
		return ""
	}

	name, _, _ := strings.Cut(entry[1:], "=")

	return entry[:1] + name
}
