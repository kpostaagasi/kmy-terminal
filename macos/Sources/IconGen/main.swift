// Uygulama simgesi üretici: 1024×1024 PNG çizer (koyu zemin, sarı yükselen grafik çizgisi).
// Kullanım: IconGen <çıktı.png>
import AppKit

let out = CommandLine.arguments.dropFirst().first ?? "icon.png"
let size: CGFloat = 1024
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let ctx = NSGraphicsContext.current!.cgContext

// macOS simge ızgarası: 824 px'lik yuvarlatılmış kare, ortalanmış
let inset: CGFloat = 100
let body = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
let radius: CGFloat = 185
let path = CGPath(roundedRect: body, cornerWidth: radius, cornerHeight: radius, transform: nil)

ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor.black.withAlphaComponent(0.35).cgColor)
ctx.addPath(path); ctx.setFillColor(NSColor(srgbRed: 0.06, green: 0.08, blue: 0.11, alpha: 1).cgColor); ctx.fillPath()
ctx.restoreGState()

ctx.saveGState()
ctx.addPath(path); ctx.clip()
let bg = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [
  NSColor(srgbRed: 0.13, green: 0.16, blue: 0.21, alpha: 1).cgColor,
  NSColor(srgbRed: 0.05, green: 0.06, blue: 0.09, alpha: 1).cgColor,
] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(bg, start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0), options: [])

// İnce ızgara çizgileri
ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.06).cgColor)
ctx.setLineWidth(4)
for i in 1..<5 {
  let y = body.minY + body.height * CGFloat(i) / 5
  ctx.move(to: CGPoint(x: body.minX, y: y)); ctx.addLine(to: CGPoint(x: body.maxX, y: y))
}
ctx.strokePath()

// Yükselen fiyat çizgisi (marka simgesindeki kırılma noktaları) ve altında yumuşak dolgu
let pts: [CGPoint] = [(0.14, 0.30), (0.36, 0.50), (0.52, 0.38), (0.86, 0.76)].map { CGPoint(x: body.minX + body.width * $0.0, y: body.minY + body.height * $0.1) }
let yellow = NSColor(srgbRed: 0.98, green: 0.80, blue: 0.08, alpha: 1)
let area = CGMutablePath()
area.move(to: CGPoint(x: pts[0].x, y: body.minY)); pts.forEach { area.addLine(to: $0) }; area.addLine(to: CGPoint(x: pts.last!.x, y: body.minY)); area.closeSubpath()
ctx.saveGState()
ctx.addPath(area); ctx.clip()
let fill = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: [yellow.withAlphaComponent(0.35).cgColor, yellow.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(fill, start: CGPoint(x: 0, y: pts.last!.y), end: CGPoint(x: 0, y: body.minY), options: [])
ctx.restoreGState()

let line = CGMutablePath(); line.addLines(between: pts)
ctx.addPath(line)
ctx.setStrokeColor(yellow.cgColor); ctx.setLineWidth(58); ctx.setLineCap(.round); ctx.setLineJoin(.round)
ctx.strokePath()
// Uç noktası
ctx.setFillColor(yellow.cgColor)
ctx.fillEllipse(in: CGRect(x: pts.last!.x - 52, y: pts.last!.y - 52, width: 104, height: 104))
ctx.restoreGState()

NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("Simge yazıldı: \(out)")
