const fs = require("fs");
function parseTime12h(timeStr) {
    let [time, modifier] = timeStr.split(" ");
    let [hours, minutes, seconds] = time.split(":").map(Number);

    if (modifier.toLowerCase() === "pm" && hours !== 12) hours += 12;
    if (modifier.toLowerCase() === "am" && hours === 12) hours = 0;

    return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(totalSeconds) {
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2,"0")}:${seconds.toString().padStart(2,"0")}`;
}

function getShiftDuration(startTime, endTime) {
    let startSec = parseTime12h(startTime);
    let endSec = parseTime12h(endTime);
    let diff = endSec - startSec;
    if (diff < 0) diff += 24 * 3600;
    return formatDuration(diff);
}

function getIdleTime(startTime, endTime) {
let startSec = parseTime12h(startTime);
    let endSec = parseTime12h(endTime);
    let deliveryStart = parseTime12h("8:00:00 am");
    let deliveryEnd = parseTime12h("10:00:00 pm");
    let idle = 0;
    if (startSec < deliveryStart) idle += Math.min(deliveryStart - startSec, endSec - startSec);
    if (endSec > deliveryEnd) idle += endSec - Math.max(deliveryEnd, startSec);
    return formatDuration(idle);
}

function parseDuration(durationStr) {
    let [h, m, s] = durationStr.split(":").map(Number);
    return h * 3600 + m * 60 + s;
}
function getActiveTime(shiftDuration, idleTime) {
    let shiftSec = parseDuration(shiftDuration);
    let idleSec = parseDuration(idleTime);
    return formatDuration(shiftSec - idleSec);
}

function metQuota(date, activeTime) {
    let activeSec = parseDuration(activeTime);
    let quotaSec = (8 * 3600) + (24 * 60); 
    let eidStart = new Date("2025-04-10");
    let eidEnd = new Date("2025-04-30");
    let current = new Date(date);
    if (current >= eidStart && current <= eidEnd) quotaSec = 6 * 3600;
    return activeSec >= quotaSec;
}

    
    function addShiftRecord(textFile, shiftObj) {
    let data = fs.readFileSync(textFile, "utf-8").trim().split("\n");
    for (let row of data) {
        let [id, , date] = row.split(",");
        if (id === shiftObj.driverID && date === shiftObj.date) return {};
    }
    let shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    let idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    let activeTime = getActiveTime(shiftDuration, idleTime);
    let quota = metQuota(shiftObj.date, activeTime);
    let newEntry = {
        driverID: shiftObj.driverID,
        driverName: shiftObj.driverName,
        date: shiftObj.date,
        startTime: shiftObj.startTime,
        endTime: shiftObj.endTime,
        shiftDuration,
        idleTime,
        activeTime,
        metQuota: quota,
        hasBonus: false
    };
    let line = Object.values(newEntry).join(",");
    data.push(line);
    fs.writeFileSync(textFile, data.join("\n"));
    return newEntry;
}



function setBonus(textFile, driverID, date, newValue) {
let data = fs.readFileSync(textFile, "utf-8").trim().split("\n");
    for (let i = 0; i < data.length; i++) {
        let parts = data[i].split(",");
        if (parts[0] === driverID && parts[2] === date) {
            parts[9] = newValue;
            data[i] = parts.join(",");
            break;
        }
    }
    fs.writeFileSync(textFile, data.join("\n"));
}

function countBonusPerMonth(textFile, driverID, month) {
    let data = fs.readFileSync(textFile, "utf-8").trim().split("\n");
    let count = 0, found = false;
    for (let row of data) {
        let parts = row.split(",");
        if (parts[0] === driverID) {
            found = true;
            let m = parts[2].split("-")[1];
            if (parseInt(m) === parseInt(month)) {
                let hasBonus = parts[9].trim().toLowerCase();
                if (hasBonus === "true") count++;
            }
        }
    }
    return found ? count : -1;
}



function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    let data = fs.readFileSync(textFile, "utf-8").trim().split("\n");
    let total = 0;
    for (let row of data) {
        let parts = row.split(",");
        if (parts[0] === driverID) {
            let m = parts[2].split("-")[1];
            if (parseInt(m) === month) total += parseDuration(parts[7]);
        }
    }
    return formatDuration(total);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    let shifts = fs.readFileSync(textFile, "utf-8").trim().split("\n");
    let rates = fs.readFileSync(rateFile, "utf-8").trim().split("\n");
    let driverRate = rates.find(r => r.split(",")[0] === driverID);
    if (!driverRate) return "0:00:00";
    let [id, dayOff] = driverRate.split(",");
    let total = 0;
    for (let row of shifts) {
        let parts = row.split(",");
        if (parts[0] === driverID) {
            let [year, m, day] = parts[2].split("-");
            if (parseInt(m) === month) {
                let dateObj = new Date(parts[2]);
                let weekday = dateObj.toLocaleDateString("en-US", { weekday: "long" });
                if (weekday === dayOff) continue;
                let eidStart = new Date("2025-04-10");
                let eidEnd = new Date("2025-04-30");
                let quotaSec = (8 * 3600) + (24 * 60); 
                if (dateObj >= eidStart && dateObj <= eidEnd) quotaSec = 6 * 3600;
                total += quotaSec;
            }
        }
    }
    total -= bonusCount * 2 * 3600;
    if (total < 0) total = 0;
    return formatDuration(total);
}


function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    let rates = fs.readFileSync(rateFile, "utf-8").trim().split("\n");
    let driverRate = rates.find(r => r.split(",")[0] === driverID);
    if (!driverRate) return 0;
    let [id, dayOff, basePayStr, tierStr] = driverRate.split(",");
    let basePay = parseInt(basePayStr);
    let tier = parseInt(tierStr);
    let actualSec = parseDuration(actualHours);
    let requiredSec = parseDuration(requiredHours);
    if (actualSec >= requiredSec) return basePay;
    let missingSec = requiredSec - actualSec;
    let missingHours = Math.floor(missingSec / 3600);
    let allowance = 0;
    if (tier === 1) allowance = 50;
    else if (tier === 2) allowance = 20;
    else if (tier === 3) allowance = 10;
    else if (tier === 4) allowance = 3;
    missingHours = Math.max(0, missingHours - allowance);
    let deductionRatePerHour = Math.floor(basePay / 185);
    let salaryDeduction = missingHours * deductionRatePerHour;
    return basePay - salaryDeduction;
}

// added my own test cases to check each function separately.


module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};

