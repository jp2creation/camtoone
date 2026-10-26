# Third-party software

Camtoone Bridge itself is UNLICENSED (no open-source license granted).
The distribution contains source and lockfiles, without bundled dependencies.
`npm ci` installs the following runtime libraries and their dependency notices:

- onvif 0.8.3 — MIT — https://github.com/agsh/onvif
- qrcode 1.5.4 — MIT — https://github.com/soldair/node-qrcode
- ws 8.22.0 — MIT — https://github.com/websockets/ws
- werift 0.25.2 — MIT — https://github.com/shinyoshiaki/werift-webrtc

werift supplies ICE, DTLS and SCTP for the WebRTC DataChannel; retain the licenses
of its installed transitive dependencies as well. Android uses the separate
`io.github.webrtc-sdk:android:150.7871.01` native WebRTC distribution (BSD-style
WebRTC license and third-party notices), not a JavaScript protocol reimplementation.

Keep the original licenses in installed npm packages when redistributing images.
The container additionally installs Alpine's FFmpeg package. Its license and
build options are those of the installed distribution, including its codec
libraries; preserve Alpine package notices and assess binary redistribution
obligations before publishing an image. The native FFmpeg used for local tests
is an external test tool and is not included in the source archive.
