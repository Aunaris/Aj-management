#!/bin/bash
# 2D Animation Classroom — ดับเบิลคลิกเพื่อเปิดโปรแกรม (macOS)
cd "$(dirname "$0")"
xattr -dr com.apple.quarantine . 2>/dev/null
./runtime/node --no-warnings ./app/src/desktop.js
