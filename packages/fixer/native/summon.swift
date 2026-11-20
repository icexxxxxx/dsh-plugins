import Cocoa
import ApplicationServices
import CoreGraphics
import Darwin

let bundleIdentifier = "com.deepseek.dsh"
let newline = String(UnicodeScalar(10)!)
let uid = String(getuid())
let pidPath = "/tmp/icex-dsh-fixer-summon-" + uid + ".pid"
let logPath = "/tmp/icex-dsh-fixer-summon-" + uid + ".log"
var doubleTapInterval: CFAbsoluteTime = 0.35
let summonQueue = DispatchQueue(label: "icex-dsh-fixer.summon")

var activeTap: CFMachPort?
var lastRightOptionDown: CFAbsoluteTime = 0
var rightOptionReleased = true

func log(_ message: String) {
  let line = "[" + ISO8601DateFormatter().string(from: Date()) + "] " + message
  if let data = (line + newline).data(using: .utf8) {
    if let handle = FileHandle(forWritingAtPath: logPath) {
      handle.seekToEndOfFile()
      handle.write(data)
      handle.closeFile()
    } else {
      try? data.write(to: URL(fileURLWithPath: logPath))
    }
    FileHandle.standardError.write(data)
  }
}

func cleanupPidFile() {
  try? FileManager.default.removeItem(atPath: pidPath)
}

func ensureSingleInstance() {
  if let text = try? String(contentsOfFile: pidPath, encoding: .utf8) {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if let old = pid_t(trimmed), old > 1, old != getpid() {
      if kill(old, 0) == 0 {
        _ = kill(old, SIGTERM)
        usleep(400000)
      }
    }
  }
  try? (String(getpid()) + newline).write(toFile: pidPath, atomically: true, encoding: .utf8)
  atexit(cleanupPidFile)
}

typealias CGSConnectionID = UInt32
typealias CGSSpaceID = UInt64
typealias ConnectionFn = @convention(c) () -> CGSConnectionID
typealias ActiveSpaceFn = @convention(c) (CGSConnectionID) -> CGSSpaceID
typealias ManagedSpacesFn = @convention(c) (CGSConnectionID) -> Unmanaged<CFArray>?
typealias SpacesForWindowsFn = @convention(c) (CGSConnectionID, Int, CFArray) -> Unmanaged<CFArray>?
typealias AddWindowsFn = @convention(c) (CGSConnectionID, CFArray, CFArray) -> Int32
typealias RemoveWindowsFn = @convention(c) (CGSConnectionID, CFArray, CFArray) -> Int32

let skyLight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_NOW)

func symbol<T>(_ name: String, _ type: T.Type) -> T? {
  guard let handle = skyLight, let pointer = dlsym(handle, name) else { return nil }
  return unsafeBitCast(pointer, to: T.self)
}

let connectionFn = symbol("_CGSDefaultConnection", ConnectionFn.self)
let activeSpaceFn = symbol("CGSGetActiveSpace", ActiveSpaceFn.self)
let managedSpacesFn = symbol("CGSCopyManagedDisplaySpaces", ManagedSpacesFn.self)
let spacesForWindowsFn = symbol("CGSCopySpacesForWindows", SpacesForWindowsFn.self)
let addWindowsFn = symbol("CGSAddWindowsToSpaces", AddWindowsFn.self)
let removeWindowsFn = symbol("CGSRemoveWindowsFromSpaces", RemoveWindowsFn.self)

func cgsConnection() -> CGSConnectionID? {
  guard let fn = connectionFn else { return nil }
  return fn()
}

struct DisplaySpaceInfo {
  let displayUUID: String
  let current: CGSSpaceID
}

func managedDisplaySpaces() -> [DisplaySpaceInfo] {
  guard let connection = cgsConnection(), let fn = managedSpacesFn else { return [] }
  guard let raw = fn(connection)?.takeRetainedValue() else { return [] }
  guard let array = raw as? NSArray else { return [] }
  var result: [DisplaySpaceInfo] = []
  for item in array {
    guard let dictionary = item as? NSDictionary else { continue }
    guard let uuid = dictionary["Display Identifier"] as? String else { continue }
    guard let current = dictionary["Current Space"] as? NSDictionary else { continue }
    guard let number = current["id64"] as? NSNumber else { continue }
    result.append(DisplaySpaceInfo(displayUUID: uuid, current: number.uint64Value))
  }
  return result
}

func displayUUID(for screen: NSScreen) -> String? {
  guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else { return nil }
  let displayID = CGDirectDisplayID(number.uint32Value)
  guard let uuidReference = CGDisplayCreateUUIDFromDisplayID(displayID) else { return nil }
  let uuid = uuidReference.takeRetainedValue()
  guard let text = CFUUIDCreateString(nil, uuid) else { return nil }
  return text as String
}

func screenForSpace(_ space: CGSSpaceID) -> NSScreen? {
  for info in managedDisplaySpaces() where info.current == space {
    for screen in NSScreen.screens {
      if displayUUID(for: screen) == info.displayUUID {
        return screen
      }
    }
  }
  return nil
}

func currentSpace(for screen: NSScreen) -> CGSSpaceID? {
  if let uuid = displayUUID(for: screen) {
    for info in managedDisplaySpaces() where info.displayUUID == uuid {
      return info.current
    }
  }
  if let connection = cgsConnection(), let fn = activeSpaceFn {
    return fn(connection)
  }
  return nil
}

func spacesForWindow(_ windowID: Int) -> [CGSSpaceID] {
  guard let connection = cgsConnection(), let fn = spacesForWindowsFn else { return [] }
  let windows = [NSNumber(value: windowID)] as CFArray
  guard let raw = fn(connection, 7, windows)?.takeRetainedValue() else { return [] }
  guard let array = raw as? NSArray else { return [] }
  var result: [CGSSpaceID] = []
  for item in array {
    if let number = item as? NSNumber {
      result.append(number.uint64Value)
    }
  }
  return result
}

func moveWindow(_ windowID: Int, to space: CGSSpaceID) -> Bool {
  guard let connection = cgsConnection() else { return false }
  let current = spacesForWindow(windowID)
  if current.contains(space) { return true }
  let windows = [NSNumber(value: windowID)] as CFArray
  let target = [NSNumber(value: space)] as CFArray
  let result = addWindowsFn?(connection, windows, target) ?? -1
  usleep(250000)
  let afterAdd = spacesForWindow(windowID)
  if afterAdd.contains(space) {
    let stale = afterAdd.filter { $0 != space }
    if !stale.isEmpty {
      let staleSpaces = stale.map { NSNumber(value: $0) } as CFArray
      _ = removeWindowsFn?(connection, windows, staleSpaces)
    }
  }
  usleep(150000)
  let after = spacesForWindow(windowID)
  log("space move window=" + String(windowID) + " from=" + String(describing: current) + " to=" + String(space) + " result=" + String(result) + " after=" + String(describing: after))
  return after.contains(space)
}

func axRaw(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  if error != .success { return nil }
  return value
}

func axPoint(_ element: AXUIElement, _ attribute: String) -> CGPoint? {
  guard let raw = axRaw(element, attribute) else { return nil }
  if CFGetTypeID(raw) != AXValueGetTypeID() { return nil }
  let value = raw as! AXValue
  var point = CGPoint.zero
  return AXValueGetValue(value, .cgPoint, &point) ? point : nil
}

func axSize(_ element: AXUIElement, _ attribute: String) -> CGSize? {
  guard let raw = axRaw(element, attribute) else { return nil }
  if CFGetTypeID(raw) != AXValueGetTypeID() { return nil }
  let value = raw as! AXValue
  var size = CGSize.zero
  return AXValueGetValue(value, .cgSize, &size) ? size : nil
}

func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
  guard let raw = axRaw(element, attribute) else { return nil }
  if CFGetTypeID(raw) != CFBooleanGetTypeID() { return nil }
  return CFBooleanGetValue((raw as! CFBoolean))
}

func setAXBool(_ element: AXUIElement, _ attribute: String, _ value: Bool) {
  let flag = value ? kCFBooleanTrue! : kCFBooleanFalse!
  _ = AXUIElementSetAttributeValue(element, attribute as CFString, flag)
}

func setAXPoint(_ element: AXUIElement, _ attribute: String, _ point: CGPoint) {
  var mutable = point
  if let value = AXValueCreate(.cgPoint, &mutable) {
    _ = AXUIElementSetAttributeValue(element, attribute as CFString, value)
  }
}

func setAXSize(_ element: AXUIElement, _ attribute: String, _ size: CGSize) {
  var mutable = size
  if let value = AXValueCreate(.cgSize, &mutable) {
    _ = AXUIElementSetAttributeValue(element, attribute as CFString, value)
  }
}

struct FoundWindow {
  let pid: pid_t
  let windowID: Int
  let axWindow: AXUIElement
  let bounds: CGRect
}

func findWindow(pid: pid_t) -> FoundWindow? {
  let options: CGWindowListOption = [.optionAll, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return nil }
  var bestID = 0
  var bestArea: CGFloat = 0
  var bestBounds = CGRect.zero
  for item in list {
    guard let owner = item[kCGWindowOwnerPID as String] as? NSNumber, owner.int32Value == pid else { continue }
    guard let layer = item[kCGWindowLayer as String] as? NSNumber, layer.intValue == 0 else { continue }
    guard let bounds = item[kCGWindowBounds as String] as? NSDictionary else { continue }
    guard let rect = CGRect(dictionaryRepresentation: bounds) else { continue }
    if rect.width < 300 || rect.height < 200 { continue }
    let area = rect.width * rect.height
    if area > bestArea {
      bestArea = area
      bestID = (item[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
      bestBounds = rect
    }
  }
  if bestID == 0 { return nil }
  let axApp = AXUIElementCreateApplication(pid)
  guard let raw = axRaw(axApp, kAXWindowsAttribute) else { return nil }
  guard let array = raw as? NSArray else { return nil }
  var bestWindow: AXUIElement?
  var bestAXArea: CGFloat = 0
  for item in array {
    let window = item as! AXUIElement
    if let size = axSize(window, kAXSizeAttribute) {
      let area = size.width * size.height
      if area > bestAXArea {
        bestAXArea = area
        bestWindow = window
      }
    }
  }
  guard let axWindow = bestWindow else { return nil }
  return FoundWindow(pid: pid, windowID: bestID, axWindow: axWindow, bounds: bestBounds)
}

func primaryScreenHeight() -> CGFloat {
  if let primary = NSScreen.screens.first(where: { $0.frame.origin == .zero }) {
    return primary.frame.height
  }
  return NSScreen.screens.first?.frame.height ?? 0
}

func targetScreen(index: Int?) -> NSScreen? {
  let screens = NSScreen.screens
  if screens.isEmpty { return nil }
  if let value = index, value >= 0, value < screens.count {
    return screens[value]
  }
  let mouse = NSEvent.mouseLocation
  if let hit = screens.first(where: { NSMouseInRect(mouse, $0.frame, false) }) {
    return hit
  }
  return NSScreen.main ?? screens[0]
}

func screenContainingWindow(_ rect: CGRect) -> NSScreen? {
  let primary = primaryScreenHeight()
  let point = CGPoint(x: rect.midX, y: primary - rect.midY)
  return NSScreen.screens.first(where: { NSMouseInRect(point, $0.frame, false) })
}

func targetRect(for screen: NSScreen, height: CGFloat) -> CGRect {
  let frame = screen.frame
  let visible = screen.visibleFrame
  let top = primaryScreenHeight() - (visible.origin.y + visible.height)
  let finalHeight = min(height, visible.height)
  return CGRect(x: frame.origin.x, y: top, width: frame.width, height: finalHeight)
}

func bringApplicationToFront(_ app: NSRunningApplication) {
  let opener = Process()
  opener.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  if let bundle = app.bundleURL {
    opener.arguments = [bundle.path]
  } else {
    opener.arguments = ["-a", "DeepSeek Harness"]
  }
  do {
    try opener.run()
    opener.waitUntilExit()
  } catch {
    log("open application failed: " + error.localizedDescription)
  }
  usleep(700000)
  if !app.isActive {
    app.unhide()
    app.activate(options: [.activateAllWindows])
    usleep(250000)
  }
  if !app.isActive {
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    _ = AXUIElementSetAttributeValue(axApp, kAXFrontmostAttribute as CFString, kCFBooleanTrue)
    usleep(200000)
  }
}

func summon(screenIndex: Int?) -> Bool {
  guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first else {
    log("DSH application not running")
    return false
  }
  app.unhide()
  bringApplicationToFront(app)
  guard let target = targetScreen(index: screenIndex) else {
    log("no screen available")
    return false
  }
  var initial = findWindow(pid: app.processIdentifier)
  if initial == nil {
    log("window not found; activating the application")
    bringApplicationToFront(app)
    usleep(700000)
    initial = findWindow(pid: app.processIdentifier)
  }
  guard let initialWindow = initial else {
    log("DSH window not found")
    return false
  }
  var window = initialWindow
  if axBool(window.axWindow, "AXFullScreen") == true {
    setAXBool(window.axWindow, "AXFullScreen", false)
    log("leaving fullscreen")
    usleep(1100000)
    if let refreshed = findWindow(pid: app.processIdentifier) { window = refreshed }
  }
  if axBool(window.axWindow, kAXMinimizedAttribute) == true {
    setAXBool(window.axWindow, kAXMinimizedAttribute, false)
    usleep(250000)
    if let refreshed = findWindow(pid: app.processIdentifier) { window = refreshed }
  }
  let height = axSize(window.axWindow, kAXSizeAttribute)?.height ?? target.visibleFrame.height
  let windowSpaces = spacesForWindow(window.windowID)
  var boundScreen = target
  var moved = true
  if let space = currentSpace(for: target) {
    if !windowSpaces.contains(space) {
      moved = moveWindow(window.windowID, to: space)
      if !moved {
        let fallback = windowSpaces.compactMap { screenForSpace($0) }.first
          ?? screenContainingWindow(window.bounds)
        boundScreen = fallback ?? target
        log("space move blocked by the system; activating the window on its current desktop")
      }
    }
  } else {
    log("target space unknown; positioning on the pointer screen")
  }
  usleep(180000)
  if let refreshed = findWindow(pid: app.processIdentifier) { window = refreshed }
  let rect = targetRect(for: boundScreen, height: height)
  setAXPoint(window.axWindow, kAXPositionAttribute, rect.origin)
  setAXSize(window.axWindow, kAXSizeAttribute, rect.size)
  usleep(120000)
  AXUIElementPerformAction(window.axWindow, kAXRaiseAction as CFString)
  log("summoned screen=" + String(describing: boundScreen.frame) + " rect=" + String(describing: rect) + " height=" + String(Double(rect.height)) + " fallback=" + String(!moved))
  return true
}

func tapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    if let tap = activeTap {
      CGEvent.tapEnable(tap: tap, enable: true)
    }
    return Unmanaged.passUnretained(event)
  }
  if type != .flagsChanged {
    return Unmanaged.passUnretained(event)
  }
  let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
  if keyCode != 61 {
    return Unmanaged.passUnretained(event)
  }
  let isDown = event.flags.contains(.maskAlternate)
  let now = CFAbsoluteTimeGetCurrent()
  if isDown {
    if rightOptionReleased && lastRightOptionDown > 0 && (now - lastRightOptionDown) <= doubleTapInterval {
      lastRightOptionDown = 0
      rightOptionReleased = false
      log("right option double tap")
      summonQueue.async {
        _ = summon(screenIndex: nil)
      }
    } else {
      lastRightOptionDown = now
      rightOptionReleased = false
    }
  } else {
    rightOptionReleased = true
  }
  return Unmanaged.passUnretained(event)
}

func preparePermissions() {
  if !AXIsProcessTrusted() {
    let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
    _ = AXIsProcessTrustedWithOptions(options)
  }
  if !CGPreflightListenEventAccess() {
    _ = CGRequestListenEventAccess()
  }
  log("permissions ax=" + String(AXIsProcessTrusted()) + " listen=" + String(CGPreflightListenEventAccess()))
}

func installTap() {
  if activeTap != nil { return }
  let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
  guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: tapCallback, userInfo: nil) else {
    log("event tap unavailable; retrying in 2s")
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      installTap()
    }
    return
  }
  activeTap = tap
  guard let source = CFMachPortCreateRunLoopSource(nil, tap, 0) else {
    log("event tap source unavailable")
    return
  }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  log("event tap ready")
}

if let attributes = try? FileManager.default.attributesOfItem(atPath: logPath), let size = attributes[.size] as? NSNumber, size.intValue > 262144 {
  try? FileManager.default.removeItem(atPath: logPath)
}

let arguments = CommandLine.arguments
var summonOnce = false
var screenArgument: Int? = nil
var argumentIndex = 1
while argumentIndex < arguments.count {
  let argument = arguments[argumentIndex]
  if argument == "--summon" {
    summonOnce = true
  } else if argument == "--screen", argumentIndex + 1 < arguments.count {
    screenArgument = Int(arguments[argumentIndex + 1])
    argumentIndex += 1
  } else if argument == "--interval", argumentIndex + 1 < arguments.count {
    if let milliseconds = Double(arguments[argumentIndex + 1]) {
      doubleTapInterval = milliseconds / 1000.0
    }
    argumentIndex += 1
  }
  argumentIndex += 1
}

if summonOnce {
  log("one-shot summon")
  let ok = summon(screenIndex: screenArgument)
  log("one-shot result " + String(ok))
  exit(ok ? 0 : 1)
}

ensureSingleInstance()
preparePermissions()
installTap()
log("helper running pid=" + String(getpid()))
CFRunLoopRun()
