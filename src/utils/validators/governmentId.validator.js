// ─────────────────────────────────────────────────────────────
//  Verhoeff Algorithm (Aadhaar checksum)
// ─────────────────────────────────────────────────────────────
const VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const verhoeffCheck = (num) => {
    let c = 0;
    const digits = String(num).split("").reverse().map(Number);
    for (let i = 0; i < digits.length; i++) {
        c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits[i]]];
    }
    return c === 0;
};


// ─────────────────────────────────────────────────────────────
//  Individual Validators
// ─────────────────────────────────────────────────────────────
const validators = {

    aadhaar: (value) => {
        const cleaned = value.replace(/\s/g, "");

        if (!/^\d{12}$/.test(cleaned)) {
            return { valid: false, message: "Aadhaar must be exactly 12 digits" };
        }
        if (/^[01]/.test(cleaned)) {
            return { valid: false, message: "Aadhaar number cannot start with 0 or 1" };
        }
        if (!verhoeffCheck(cleaned)) {
            return { valid: false, message: "Aadhaar checksum is invalid — please re-check the number" };
        }

        return { valid: true };
    },

    pan: (value) => {
        const cleaned = value.trim().toUpperCase();

        if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleaned)) {
            return {
                valid: false,
                message: "PAN must be in format: ABCDE1234F (5 letters, 4 digits, 1 letter)",
            };
        }

        // 4th character = entity type
        const validEntityChars = ["P", "C", "H", "F", "A", "T", "B", "L", "J", "G"];
        if (!validEntityChars.includes(cleaned[3])) {
            return { valid: false, message: `PAN 4th character '${cleaned[3]}' is not a valid entity type` };
        }

        return { valid: true };
    },

    passport: (value) => {
        const cleaned = value.trim().toUpperCase();

        if (!/^[A-Z]{1}[0-9]{7}$/.test(cleaned)) {
            return {
                valid: false,
                message: "Passport must be in format: A1234567 (1 letter + 7 digits)",
            };
        }

        return { valid: true };
    },

    voter_id: (value) => {
        const cleaned = value.trim().toUpperCase();

        if (!/^[A-Z]{3}[0-9]{7}$/.test(cleaned)) {
            return {
                valid: false,
                message: "Voter ID must be in format: ABC1234567 (3 letters + 7 digits)",
            };
        }

        return { valid: true };
    },

    driving_license: (value) => {
        // Format: 2 letter state code + 13 digits  e.g. MH0120191234567
        const cleaned = value.trim().toUpperCase().replace(/-/g, "").replace(/\s/g, "");

        if (!/^[A-Z]{2}[0-9]{13}$/.test(cleaned)) {
            return {
                valid: false,
                message: "Driving license must be: 2 state letters + 13 digits (e.g. MH0120191234567)",
            };
        }

        return { valid: true };
    },

    other: (value) => {
        if (!value || value.trim().length < 4) {
            return { valid: false, message: "ID number must be at least 4 characters" };
        }
        return { valid: true };
    },
};


// ─────────────────────────────────────────────────────────────
//  Main Export
// ─────────────────────────────────────────────────────────────
const validateGovernmentId = (idType, idNumber) => {
    if (!idType || !idNumber) {
        return { valid: false, message: "idType and idNumber are both required" };
    }

    const validator = validators[idType];
    if (!validator) {
        return { valid: false, message: `Unknown ID type: ${idType}` };
    }

    return validator(idNumber);
};

module.exports = { validateGovernmentId };