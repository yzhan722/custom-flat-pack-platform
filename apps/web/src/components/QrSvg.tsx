import QRCode from "qrcode";

/** Compact SVG QR code for labels. Payloads must not include personal data (PRD §11). */
export async function QrSvg({ value, size = 88 }: { value: string; size?: number }) {
  const svg = await QRCode.toString(value, { type: "svg", margin: 0, width: size, errorCorrectionLevel: "M" });
  return <span className="inline-block overflow-hidden bg-white" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
