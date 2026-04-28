// ─────────────────────────────────────────────────────────────
//  1. Account Holder Name
// ─────────────────────────────────────────────────────────────
const validateAccountHolderName = (name) => {
    const cleaned = name.trim();

    if (cleaned.length < 3) {
        return { valid: false, message: "Account holder name must be at least 3 characters" };
    }
    if (!/^[a-zA-Z\s.'-]+$/.test(cleaned)) {
        return {
            valid: false,
            message: "Account holder name can only contain letters, spaces, dots, hyphens and apostrophes",
        };
    }

    return { valid: true };
};


// ─────────────────────────────────────────────────────────────
//  2. Account Number Format
// ─────────────────────────────────────────────────────────────
const validateAccountNumber = (accountNumber) => {
    const cleaned = accountNumber.trim();

    if (!/^\d{9,18}$/.test(cleaned)) {
        return { valid: false, message: "Account number must be between 9 and 18 digits" };
    }

    return { valid: true };
};


// ─────────────────────────────────────────────────────────────
//  3. IFSC Format
// ─────────────────────────────────────────────────────────────
const validateIFSCFormat = (ifsc) => {
    const cleaned = ifsc.trim().toUpperCase();

    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(cleaned)) {
        return {
            valid: false,
            message: "IFSC must be in format: ABCD0123456 (4 letters, 0, then 6 alphanumeric)",
        };
    }

    return { valid: true, cleaned };
};


// ─────────────────────────────────────────────────────────────
//  4. IFSC Live Lookup  (free public API — no key, no axios)
// ─────────────────────────────────────────────────────────────
const lookupIFSC = async (ifsc) => {
    try {
        const response = await fetch(`https://ifsc.razorpay.com/${ifsc}`, {
            signal: AbortSignal.timeout(5000),   // built-in timeout, no axios needed
        });

        if (response.status === 404) {
            return { valid: false, message: "IFSC code does not exist — please double-check" };
        }

        if (!response.ok) {
            // Any other non-200 — don't block the user
            return {
                valid: true,
                warning: "IFSC lookup returned an unexpected response, live check skipped",
                bankInfo: null,
            };
        }

        const data = await response.json();

        return {
            valid: true,
            bankInfo: {
                bank: data.BANK,
                branch: data.BRANCH,
                city: data.CITY,
                state: data.STATE,
                rtgs: data.RTGS,
                neft: data.NEFT,
                imps: data.IMPS,
            },
        };

    } catch (err) {
        // Covers: network down, AbortSignal timeout, JSON parse failure
        return {
            valid: true,
            warning: "IFSC lookup service unavailable, live check skipped",
            bankInfo: null,
        };
    }
};


// ─────────────────────────────────────────────────────────────
//  Main Export — runs all steps in order
// ─────────────────────────────────────────────────────────────
const validateBankDetails = async ({ accountNumber, ifsc, accountHolderName }) => {
    const errors = [];

    // Step 1 — name
    const nameCheck = validateAccountHolderName(accountHolderName);
    if (!nameCheck.valid) errors.push(nameCheck.message);

    // Step 2 — account number
    const accCheck = validateAccountNumber(accountNumber);
    if (!accCheck.valid) errors.push(accCheck.message);

    // Step 3 — IFSC format
    const ifscFormat = validateIFSCFormat(ifsc);
    if (!ifscFormat.valid) {
        errors.push(ifscFormat.message);
        return { valid: false, errors }; // no point hitting the API with bad format
    }

    if (errors.length > 0) return { valid: false, errors };

    // Step 4 — IFSC live lookup
    const ifscLookup = await lookupIFSC(ifscFormat.cleaned);
    if (!ifscLookup.valid) {
        errors.push(ifscLookup.message);
        return { valid: false, errors };
    }

    return {
        valid: true,
        errors: [],
        bankInfo: ifscLookup.bankInfo,
        warning: ifscLookup.warning || null,
    };
};

module.exports = { validateBankDetails };