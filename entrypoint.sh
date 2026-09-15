#!/bin/sh
# Starts a virtual display, optionally exposes it over VNC for the one-time
# Reddit login, then runs the watcher against it.
set -e

export DISPLAY="${DISPLAY:-:99}"
SCREEN="${SCREEN_GEOMETRY:-1280x900x24}"

# A container *restart* keeps the filesystem, so /tmp/.X<n>-lock and the socket
# outlive the Xvfb that made them and the next start dies with "Server is
# already active". Any process that owned them is gone by the time this runs,
# so clearing them is safe — and without it a crash-restart never recovers.
DISPLAY_NUM="${DISPLAY#:}"
DISPLAY_NUM="${DISPLAY_NUM%%.*}"
if [ -e "/tmp/.X${DISPLAY_NUM}-lock" ] || [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
  rm -f "/tmp/.X${DISPLAY_NUM}-lock" "/tmp/.X11-unix/X${DISPLAY_NUM}"
  echo "Cleared stale X lock/socket for display $DISPLAY"
fi

Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp &
for _ in $(seq 1 60); do
  xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
  sleep 0.25
done
xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 || { echo "Xvfb failed to start on $DISPLAY"; exit 1; }
echo "Xvfb ready on $DISPLAY ($SCREEN)"

# x11vnc is bound to the container port only; compose publishes it on
# 127.0.0.1 so it is reachable exclusively through an SSH tunnel.
if [ "${VNC_ENABLE:-true}" = "true" ]; then
  if [ -n "${VNC_PASSWORD:-}" ]; then
    x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -passwd "$VNC_PASSWORD" -quiet -bg
  else
    x11vnc -display "$DISPLAY" -forever -shared -rfbport 5900 -nopw -quiet -bg
  fi
  echo "x11vnc listening on :5900 (tunnel with: ssh -L 5900:127.0.0.1:5900 <host>)"
fi

# Chrome writes SingletonLock/Socket/Cookie into the profile and refuses to
# start while they point at a live instance. They name the *previous*
# container's hostname and PID, so after an unclean stop Chrome blocks forever
# waiting to hand off to a host that no longer exists. A container start means
# nothing else can hold the profile, so clearing them here is always safe.
PROFILE="${BROWSER_PROFILE_DIR:-/data/browser-profile}"
if [ -d "$PROFILE" ]; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
  echo "Cleared stale Chrome singleton locks in $PROFILE"
fi

exec node dist/index.js
