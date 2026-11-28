#!/usr/bin/env python3
"""Test broker for #318: stands in for the app. Run it outside the Sandbox.

    python3 broker.py [dir] [port]

The helper (askpass.sh) connects, sends one line saying who it is, and gets
back `ok:<password>` or `deny`. The file `<dir>/mode` picks the answer:

    wrong   a wrong password, so no real one is needed (the default)
    deny    what a Deny on the card would send
    dialog  a macOS password dialog; the password goes to sudo only

The log holds each request and the kind of answer, never a password.
"""

import os
import re
import socket
import subprocess
import sys
import threading
import time

folder = sys.argv[1] if len(sys.argv) > 1 else "/tmp/uz318"
port = int(sys.argv[2]) if len(sys.argv) > 2 else 47318
os.makedirs(folder, exist_ok=True)
log_lock = threading.Lock()

DIALOG = """on run argv
display dialog (item 1 of argv) default answer "" with hidden answer ¬
  with title "Unimatrix Zero #318 test" giving up after 300
if gave up of result then error number -128
return text returned of result
end run"""


def log(text):
    with log_lock, open(os.path.join(folder, "broker.log"), "a") as file:
        file.write(f"{time.strftime('%H:%M:%S')} {text}\n")


def mode():
    try:
        with open(os.path.join(folder, "mode")) as file:
            return file.read().strip()
    except OSError:
        return "wrong"


def dialog(request):
    command = re.search(r"parent=\[(.*?)\] grandparent", request)
    text = (
        "Unimatrix Zero research (#318). A test sudo call is asking for "
        "your Mac password. It goes to sudo only and is not saved.\n\n"
        f"Command: {command.group(1) if command else 'unknown'}"
    )
    result = subprocess.run(
        ["osascript", "-e", DIALOG, text], capture_output=True, text=True
    )
    return result.stdout.rstrip("\n") if result.returncode == 0 else None


def answer(connection, channel):
    with connection:
        request = connection.makefile().readline().strip()
        chosen = mode()
        log(f"request over {channel}, mode {chosen}: {request}")
        if chosen == "dialog":
            password = dialog(request)
            reply = "deny" if password is None else f"ok:{password}"
        elif chosen == "deny":
            reply = "deny"
        else:
            reply = "ok:not-the-password"
        pid = re.search(r"pid=(\d+)", request)
        log(f"answered {reply.split(':')[0]} to pid {pid.group(1) if pid else '?'}")
        connection.sendall((reply + "\n").encode())


def serve(server, channel):
    while True:
        connection, _ = server.accept()
        threading.Thread(target=answer, args=(connection, channel)).start()


path = os.path.join(folder, "broker.sock")
if os.path.exists(path):
    os.remove(path)
unix = socket.socket(socket.AF_UNIX)
unix.bind(path)
unix.listen()
tcp = socket.socket()
tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
tcp.bind(("127.0.0.1", port))
tcp.listen()
threading.Thread(target=serve, args=(unix, "unix"), daemon=True).start()
log(f"listening on {path} and 127.0.0.1:{port}")
serve(tcp, "tcp")
