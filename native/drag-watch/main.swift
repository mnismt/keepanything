// KeepAnything drag watcher.
//
// A tiny sidecar that tells the app when the user starts dragging something, anywhere on the
// desktop, so the shelf can appear by itself instead of waiting for a tray click.
//
// macOS publishes no "a drag session started" notification, and Electron only sees drags that
// enter one of its own windows. What every drag session does do is write its payload to the
// shared drag pasteboard as it begins. So: while a mouse button is held, a bumped changeCount
// on that pasteboard means a real drag is in flight. Only `changeCount` and the type *names*
// are ever read - never the data - so this needs no entitlement and shows no permission prompt.
//
// Protocol: newline-delimited JSON on stdout.
//   {"event":"ready"}
//   {"event":"drag-start","types":["public.file-url", ...]}
//   {"event":"drag-end"}
//   {"event":"tick"}                       // heartbeat, every ~2s
//
// The heartbeat is also how the process notices its parent died: writing to a closed pipe
// fails and the watcher exits instead of lingering as an orphan.

import AppKit

/// Poll interval while no mouse button is down. Bounds how late a drag can be noticed.
let idleInterval = 0.1
/// Poll interval while a button is held, i.e. while a drag could begin at any moment.
let activeInterval = 0.025
/// Heartbeat period.
let heartbeatInterval = 2.0

// A dead parent must surface as a write error we can handle, not as a signal.
signal(SIGPIPE, SIG_IGN)

let output = FileHandle.standardOutput

func emit(_ payload: [String: Any]) {
    guard let json = try? JSONSerialization.data(withJSONObject: payload),
          let line = (String(decoding: json, as: UTF8.self) + "\n").data(using: .utf8)
    else { return }
    do { try output.write(contentsOf: line) } catch { exit(0) }
}

let pasteboard = NSPasteboard(name: .drag)

/// Change count sampled while no button is down: the value a fresh press is compared against.
var restingChangeCount = pasteboard.changeCount
/// Change count captured at the moment the current press began.
var pressChangeCount = restingChangeCount
var wasDown = false
var dragging = false
var sinceHeartbeat = 0.0

emit(["event": "ready"])

while true {
    let down = NSEvent.pressedMouseButtons & 1 != 0

    if down {
        // Compare against the value from *before* the press: by the time a drag session exists
        // the pasteboard has already been written, so sampling it now would hide the bump.
        if !wasDown { pressChangeCount = restingChangeCount }
        if !dragging && pasteboard.changeCount != pressChangeCount {
            dragging = true
            emit(["event": "drag-start", "types": pasteboard.types?.map(\.rawValue) ?? []])
        }
    } else {
        if dragging { emit(["event": "drag-end"]) }
        dragging = false
        restingChangeCount = pasteboard.changeCount
    }
    wasDown = down

    let interval = down ? activeInterval : idleInterval
    sinceHeartbeat += interval
    if sinceHeartbeat >= heartbeatInterval {
        sinceHeartbeat = 0
        emit(["event": "tick"])
    }
    Thread.sleep(forTimeInterval: interval)
}
