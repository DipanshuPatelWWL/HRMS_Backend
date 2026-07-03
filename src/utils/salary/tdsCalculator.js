// utils/salary/tdsCalculator.js

const round2 = (n) => Math.round(n * 100) / 100;

const TAX_CONFIG = {
    "2024-25": {
        standardDeduction: 75000,
        rebateLimit: 700000,
        rebateMaxTax: 25000,
        cess: 0.04,
        slabs: [
            { limit: 300000, rate: 0.00 },
            { limit: 700000, rate: 0.05 },
            { limit: 1000000, rate: 0.10 },
            { limit: 1200000, rate: 0.15 },
            { limit: 1500000, rate: 0.20 },
            { limit: Infinity, rate: 0.30 },
        ]
    },
    "2025-26": {
        standardDeduction: 75000,
        rebateLimit: 1200000,
        rebateMaxTax: 60000,
        cess: 0.04,
        slabs: [
            { limit: 400000, rate: 0.00 },
            { limit: 800000, rate: 0.05 },
            { limit: 1200000, rate: 0.10 },
            { limit: 1600000, rate: 0.15 },
            { limit: 2000000, rate: 0.20 },
            { limit: 2400000, rate: 0.25 },
            { limit: Infinity, rate: 0.30 },
        ]
    }
};

const DEFAULT_FY = "2025-26";

function getTaxConfig(fy) {
    if (!fy || !TAX_CONFIG[fy]) {
        return TAX_CONFIG[DEFAULT_FY];
    }
    return TAX_CONFIG[fy];
}

function calculateSlabTax(taxableIncome, slabs) {
    let tax = 0;
    let prev = 0;

    for (const slab of slabs) {
        if (taxableIncome <= prev) break;
        const taxable = Math.min(taxableIncome, slab.limit) - prev;
        tax += taxable * slab.rate;
        prev = slab.limit;
    }

    return tax;
}

function calculateAnnualTax(annualGross, fy = DEFAULT_FY) {
    const config = getTaxConfig(fy);

    // Step 1: Standard Deduction
    const taxableIncome = Math.max(0, annualGross - config.standardDeduction);

    // Step 2: Slab Tax
    let tax = calculateSlabTax(taxableIncome, config.slabs);

    // Step 3: Rebate u/s 87A
    if (taxableIncome <= config.rebateLimit && tax <= config.rebateMaxTax) {
        tax = 0;
    }

    // Step 4: 4% Health & Education Cess
    const cess = tax * config.cess;
    const totalTax = Math.round(tax + cess);

    return {
        annualGross,
        standardDeduction: config.standardDeduction,
        taxableIncome,
        annualTax: totalTax,
        monthlyTDS: Math.round(totalTax / 12),
        effectiveRate: annualGross > 0 ? round2((totalTax / annualGross) * 100) : 0,
        fy: fy || DEFAULT_FY
    };
}

function calculateMonthlyTDS(monthlySalary, monthsRemaining = 12, fy = DEFAULT_FY) {
    const annualGross = monthlySalary * 12;
    const { annualTax } = calculateAnnualTax(annualGross, fy);
    return Math.round(annualTax / monthsRemaining);
}

module.exports = { calculateAnnualTax, calculateMonthlyTDS, TAX_CONFIG, DEFAULT_FY };