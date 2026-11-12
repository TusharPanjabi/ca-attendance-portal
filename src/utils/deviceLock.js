export function getOrCreateDeviceId() {
  let deviceId = localStorage.getItem("ca_firm_device_uuid");
  if (!deviceId) {
    const rawFingerprint = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      crypto.randomUUID()
    ].join("|");
    deviceId = "DEV_" + btoa(rawFingerprint).slice(0, 24);
    localStorage.setItem("ca_firm_device_uuid", deviceId);
  }
  return deviceId;
}
