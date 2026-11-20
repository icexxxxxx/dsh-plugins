#!/bin/sh
set -e
cd "$(dirname "$0")/.."
swiftc -O -swift-version 5 native/summon.swift -o native/icex-summon
