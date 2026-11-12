// 1. Haversine Formula to verify employee is physically inside the CA office
export function isWithinOfficeRadius(userLat, userLng, officeLat, officeLng, maxMeters = 50) {
  const toRad = (val) => (val * Math.PI) / 180;
  const R = 6371e3; // Earth radius in meters
  const dLat = toRad(officeLat - userLat);
  const dLon = toRad(officeLng - userLng);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(userLat)) * Math.cos(toRad(officeLat)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return { allowed: distance <= maxMeters, distance: Math.round(distance) };
}

// 2. Dynamic QR Token Generator (Changes every 15 seconds)
export function generateDynamicQRPayload(secret) {
  const timeWindow = Math.floor(Date.now() / 15000);
  const signature = btoa(`${secret}_${timeWindow}`);
  return JSON.stringify({ w: timeWindow, sig: signature });
}

// 3. Validate Scanned QR Token
export function validateQRPayload(scannedString, secret) {
  try {
    const data = JSON.parse(scannedString);
    const currentWindow = Math.floor(Date.now() / 15000);
    const validCurrent = btoa(`${secret}_${currentWindow}`) === data.sig;
    const validPrev = btoa(`${secret}_${currentWindow - 1}`) === data.sig;
    return validCurrent || validPrev;
  } catch {
    return false;
  }
}

// 4. Variable Salary Calculator (Option 1: Intern vs Option 2: Full-Time Employee)
export function calculateSessionPay(minutesWorked, role, payConfig) {
  const hoursWorked = minutesWorked / 60;

  if (role === "INTERN") {
    return Number((hoursWorked * (payConfig?.rate || 0)).toFixed(2));
  }

  if (role === "EMPLOYEE") {
    const workingDaysInMonth = 26;
    const standardHours = payConfig?.standardDailyHours || 8;
    const hourlyRate = (payConfig?.rate || 0) / (workingDaysInMonth * standardHours);

    if (hoursWorked <= standardHours) {
      return Number((hoursWorked * hourlyRate).toFixed(2));
    } else {
      const regularPay = standardHours * hourlyRate;
      const overtimeHours = hoursWorked - standardHours;
      const overtimePay = overtimeHours * hourlyRate * (payConfig?.overtimeMultiplier || 1.5);
      return Number((regularPay + overtimePay).toFixed(2));
    }
  }
  return 0;
}
