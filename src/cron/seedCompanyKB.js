// src/cron/seedPersonalIntents.js

require("dotenv").config();
const mongoose = require("mongoose");
const CompanyKB = require("../models/CompanyKB");

const entries = [
    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 1. OWN NAME ────────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my name?",
        aliases: [
            "my name", "what is my name", "tell me my name", "who am i",
            "what do you call me", "my full name", "what is my full name",
            "whats my name", "can you tell me my name", "do you know my name",
            "say my name", "what should i call myself", "my name please",
            "give me my name", "show my name", "display my name", "fetch my name",
            "what name am i registered with", "my registered name",
            "name on my profile", "my profile name",
            "what is the name on my account",
            "mera naam", "mera naam kya hai", "mujhe mera naam batao",
            "apna naam batao", "naam kya hai mera", "mera poora naam",
            "mera poora naam kya hai", "mujhe mera poora naam batao",
            "mera naam bolo", "mera naam kya he",
        ],
        answer: "👤 Your name is {{name}}.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 2. OWN EMAIL ───────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my email?",
        aliases: [
            "my email", "what is my email", "my email address",
            "what is my email address", "my mail id", "my email id",
            "tell me my email", "my official email", "my work email",
            "my company email", "my registered email",
            "email on my profile", "what email am i registered with",
            "show my email", "display my email", "fetch my email",
            "give me my email", "my email please", "what is my mail",
            "my contact email", "my office email", "my office mail",
            "email address on my account", "what is my official mail id",
            "meri email", "meri email kya hai", "mujhe meri email batao",
            "mera email id kya hai", "meri official email kya hai",
            "meri company email", "mera mail id kya hai",
            "email id batao", "meri registered email kya hai",
            "meri email address batao",
        ],
        answer: "📧 Your email address is {{email}}.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 3. OWN PHONE ───────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my phone number?",
        aliases: [
            "my phone number", "my contact number", "my mobile number",
            "my number", "what is my phone number", "what is my contact number",
            "my phone", "my mobile", "my registered number",
            "my office number", "my work number", "my official number",
            "show my phone number", "display my phone number",
            "fetch my contact number", "give me my number", "my number please",
            "what number am i registered with", "phone number on my profile",
            "my contact details", "my mobile no", "my phone no",
            "my cell number", "my whatsapp number",
            "mera number", "mera phone number", "mera mobile number",
            "mera contact number", "mujhe mera number batao",
            "mera registered number kya hai", "mera official number kya hai",
            "number batao mera", "mera phone no kya hai",
            "meri contact detail batao",
        ],
        answer: "📞 Your registered phone number is {{phone}}.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 4. OWN ADDRESS ─────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my address?",
        aliases: [
            "my address", "what is my address", "my home address",
            "my residential address", "my current address", "tell me my address",
            "where do i live", "my location", "my permanent address",
            "my registered address", "address on my profile",
            "what address am i registered with", "show my address",
            "display my address", "fetch my address", "give me my address",
            "my address please", "my living address", "my house address",
            "my local address", "my office registered address",
            "my profile address", "where am i from", "my city",
            "mera address", "mera address kya hai",
            "mujhe mera address batao", "mera ghar ka address",
            "mera residential address kya hai", "mera permanent address kya hai",
            "address batao mera", "mera registered address kya hai",
            "meri location kya hai", "mera address profile pe kya hai",
        ],
        answer: "🏠 Your registered address is {{address}}.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 5. TL / TEAM LEAD ──────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Who is my team lead?",
        aliases: [
            "my tl", "my team lead", "who is my tl", "who is my team lead",
            "my tl name", "team lead name", "who leads my team",
            "my manager", "who is my manager", "my reporting manager",
            "who is my lead", "my supervisor", "who do i report to",
            "my team leader", "my reporting authority",
            "name of my tl", "name of my team lead", "name of my manager",
            "show my tl", "display my team lead", "fetch my manager name",
            "give me my tl name", "who manages me", "who is above me",
            "my senior", "my reporting head", "my project lead",
            "my tech lead", "my lead name",
            "mera tl kaun hai", "mera manager kaun hai",
            "mera team lead kaun hai", "mujhe mera tl batao",
            "mera supervisor kaun hai", "kaun hai mera tl",
            "kaun hai mera manager", "mera lead kaun hai",
            "mujhe mera manager ka naam batao",
            "mera reporting manager kaun hai",
        ],
        answer: "👨‍💼 Your Team Lead is {{tlName}}.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 6. COMPANY NAME ────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company name?",
        aliases: [
            "company name", "our company name", "my company",
            "which company", "which company am i working in",
            "which company do i work for", "which company im working",
            "what company is this", "name of company", "name of our company",
            "what is our company name", "what is my company name",
            "our company", "my company name", "tell me company name",
            "show company name", "display company name", "fetch company name",
            "what organization do i work for", "my organization name",
            "which organization am i in", "name of my organization",
            "my firm name", "which firm do i work for",
            "what is my employer name", "my employer",
            "comapny name", "comonay name", "compny name",
            "compani name", "cmpany name",
            "meri company ka naam", "meri company ka naam kya hai",
            "kis company mein kaam karta hun", "company ka naam kya hai",
            "meri firm ka naam kya hai", "mera organization ka naam kya hai",
            "main kis company mein hun", "hamari company ka naam",
            "mujhe company ka naam batao", "kahan kaam karta hun main",
        ],
        answer: "🏢 You are working at World WebLogic.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 7. COMPANY OFFICE ADDRESS / LOCATION ───────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company office address?",
        aliases: [
            "company address", "office address", "company location",
            "office location", "where is the office", "where is our office",
            "where is company located", "company office address",
            "office office address", "our office address",
            "world weblogic address", "world weblogic location",
            "company registered address", "office registered address",
            "where is world weblogic", "company place", "office place",
            "office area", "office sector", "company sector",
            "company noida address", "office noida address",
            "what is the office address", "tell me the office address",
            "show office address", "display office address",
            "company address kya hai", "company ka address",
            "office ka address", "office kahan hai",
            "company kahan hai", "office ka pata",
            "company ka pata", "hamari company ka address",
            "world weblogic ka address", "noida office address",
            "office located where", "where exactly is our office",
            "office pincode", "office pin code", "company pin code",
            "office city", "company city",
            "office near metro", "office metro station",
            "how to reach office", "office direction",
        ],
        answer: "📍 World WebLogic Office Address:\n\nB 108, 1st Floor, Office No. 2nd,\nSector 63, Noida – 201301, Uttar Pradesh, India\n\n🗺️ Nearest Metro: Sector 62 (Blue Line)",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 8. COMPANY PHONE / CONTACT NUMBER ──────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company contact number?",
        aliases: [
            "company phone number", "company contact number",
            "company phone", "company number", "office phone number",
            "office contact number", "office phone", "office number",
            "office mobile number", "company mobile number",
            "company mobile", "office mobile",
            "world weblogic phone", "world weblogic number",
            "world weblogic contact", "world weblogic phone number",
            "company helpline", "office helpline",
            "company toll free", "office toll free",
            "company landline", "office landline",
            "company telephone", "office telephone",
            "company contact", "company contact info",
            "what is the office phone number", "what is company phone",
            "company ka number", "office ka number",
            "company ka phone number", "office ka phone number",
            "company ka contact number", "office ka contact",
            "company number kya hai", "office number kya hai",
            "company phone kya hai", "call office number",
            "office contact kya hai", "company helpdesk number",
            "hr contact number", "hr phone number",
            "reception number", "reception phone",
        ],
        answer: "📞 World WebLogic Contact Numbers:\n\n• India Office: +91 120-4545733\n• Mobile: +91 85058 37801\n• USA: +1 (310) 807-2867\n\n📧 Email: info@worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 9. COMPANY EMAIL ADDRESS ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company email address?",
        aliases: [
            "company email", "office email", "company email address",
            "office email address", "company email id", "office email id",
            "company mail id", "office mail id", "company official email",
            "office official email", "company contact email",
            "office contact email", "world weblogic email",
            "world weblogic email address", "world weblogic mail",
            "company info email", "office info email",
            "company support email", "office support email",
            "company hr email", "office hr email",
            "what is company email", "what is office email",
            "company ka email", "office ka email",
            "company ka email id", "office ka email id",
            "company mail kya hai", "office mail kya hai",
            "company email kya hai", "company email address kya hai",
            "company ke email id", "official company email",
            "business email", "company business email",
            "enquiry email", "company enquiry email",
        ],
        answer: "📧 World WebLogic Official Email:\n\n• General: info@worldweblogic.com\n• Website: https://www.worldweblogic.com\n• Phone: +91 120-4545733",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 10. COMPANY WEBSITE ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company website?",
        aliases: [
            "company website", "office website", "company website link",
            "company website url", "company web address", "company url",
            "office url", "world weblogic website", "world weblogic url",
            "company site", "our website", "company web",
            "company portal", "employee portal", "office portal",
            "what is our website", "what is company website",
            "company website kya hai", "company ka website",
            "company link kya hai", "company online",
            "company domain", "what is company domain",
            "company ka website kya hai", "website link do",
            "website batao", "office ka website",
        ],
        answer: "🌐 World WebLogic Website:\n\nhttps://www.worldweblogic.com\n\n📧 Email: info@worldweblogic.com\n📞 Phone: +91 120-4545733",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 11. COMPANY SOCIAL MEDIA ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What are the company social media profiles?",
        aliases: [
            "company social media", "office social media",
            "company instagram", "office instagram",
            "company insta", "office insta", "company insta id",
            "office insta id", "company instagram id",
            "office instagram id", "company instagram handle",
            "company instagram link", "company ig", "office ig",
            "company linkedin", "office linkedin",
            "company linkedin page", "office linkedin page",
            "company linkedin link", "company linkedin id",
            "company facebook", "office facebook",
            "company facebook page", "company fb", "office fb",
            "company twitter", "office twitter", "company x handle",
            "company youtube", "office youtube",
            "company social links", "office social links",
            "all social media links", "social handles company",
            "company social profiles", "follow company on social",
            "world weblogic instagram", "world weblogic linkedin",
            "world weblogic facebook", "world weblogic social",
            "company ke social media", "company ka instagram",
            "company ka linkedin", "company ka facebook",
            "office ke social media", "social media links company",
        ],
        answer: "📱 World WebLogic on Social Media:\n\n🔵 Facebook: https://www.facebook.com/WorldWebLogic\n💼 LinkedIn: https://www.linkedin.com/company/101195736/\n📸 Instagram: https://www.instagram.com/worldweblogic\n🌐 Website: https://www.worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 12. OFFICE TIMINGS ─────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What are the office working hours?",
        aliases: [
            "office timings", "office timing", "office hours",
            "working hours", "working time", "work hours",
            "office time", "office schedule", "work schedule",
            "work timing", "office open time", "office close time",
            "office opening time", "office closing time",
            "what time does office open", "what time does office close",
            "when does office open", "when does office close",
            "office start time", "office end time",
            "office in time", "office out time",
            "punch in time", "punch out time",
            "shift timing", "shift time", "shift schedule",
            "working days", "office days",
            "what days does office work", "which days office is open",
            "is office open on saturday", "is office open sunday",
            "saturday office timing", "sunday office timing",
            "office weekend", "weekend office",
            "office open days", "office working days",
            "company timing", "company timings", "company hours",
            "company schedule", "company work hours",
            "office ka time", "office kab khulta hai",
            "office kab band hota hai", "office time kya hai",
            "office timing kya hai", "kab aana padta hai office",
            "kab jana padta hai office", "office khulne ka time",
            "office band hone ka time", "working hours kya hai",
            "kam ke ghante", "kaam ka waqt",
        ],
        answer: "🕙 World WebLogic Office Timings:\n\n• Opens: 10:00 AM\n• Closes: 7:00 PM\n• Working Days: Monday – Friday\n• Weekend: Saturday & Sunday OFF\n• Late threshold: 10:15 AM\n• Half-day threshold: 10:30 AM",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 13. LUNCH / BREAK TIME ─────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the lunch break time?",
        aliases: [
            "lunch time", "lunch break", "break time", "lunch hour",
            "lunch break time", "office lunch time", "office lunch break",
            "when is lunch", "what time is lunch", "lunch timing",
            "lunch schedule", "food break time", "tiffin time",
            "dinner break", "tea break time", "snack break time",
            "rest break", "short break time",
            "khane ka time", "lunch ka time", "break ka time",
            "kab khana milta hai", "lunch kab hoga", "break kab hai",
        ],
        answer: "🍽️ Lunch Break at World WebLogic:\n\n• Lunch: 2:00 PM – 2:30 PM (30 minutes)\n• Office Hours: Mon–Fri, 10:00 AM – 7:00 PM",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 14. MY AGE ─────────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my age?",
        aliases: [
            "my age", "what is my age", "how old am i",
            "what is my current age", "tell me my age",
            "my age in years", "how many years old am i",
            "my birth age", "my present age",
            "show my age", "display my age",
            "meri umar", "meri umar kya hai", "meri age kya hai",
            "meri age batao", "kitni age hai meri", "meri umra",
            "main kitne saal ka hun", "main kitne saal ki hun",
            "meri age kitni hai", "umar kya hai meri",
        ],
        answer: "🎂 Your age is calculated from your date of birth on record. Please ask 'what is my date of birth' or 'my dob' to view your DOB and calculate your age.\n\nAlternatively, check your full profile by asking 'my profile'.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 15. MY EMPLOYEE ID ─────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my employee ID?",
        aliases: [
            "my employee id", "my emp id", "my employee code",
            "my staff id", "what is my employee id",
            "what is my emp id", "my id", "my staff code",
            "my employee number", "what is my id",
            "my company id", "my office id", "my work id",
            "my registration number", "my unique id",
            "show my employee id", "display my emp id",
            "fetch my employee id", "my profile id",
            "mera employee id", "mera emp id", "mera id kya hai",
            "mera employee code", "mera staff id",
            "mujhe mera employee id batao",
            "mera company id kya hai",
        ],
        answer: "🪪 To see your Employee ID, please ask 'my full profile' or 'my profile details'. Your Employee ID is listed there.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 16. MY BLOOD GROUP ─────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my blood group?",
        aliases: [
            "my blood group", "what is my blood group",
            "my blood type", "what is my blood type",
            "tell me my blood group", "blood group on profile",
            "mera blood group", "mera blood group kya hai",
            "meri blood type kya hai", "blood group batao",
        ],
        answer: "🩸 Your blood group is stored in your HR profile. Please contact HR or check your profile settings to view or update your blood group.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 17. MY GENDER ──────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my gender on profile?",
        aliases: [
            "my gender", "gender on my profile", "what is my gender",
            "my gender on record", "mera gender", "mera gender kya hai",
        ],
        answer: "👤 Your gender is recorded on your HR profile. Ask 'my full profile' to view all profile details.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 18. MY MARITAL STATUS ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my marital status?",
        aliases: [
            "my marital status", "what is my marital status",
            "am i married", "relationship status on profile",
            "meri marital status", "meri marital status kya hai",
            "married status on profile",
        ],
        answer: "💍 Your marital status is stored in your HR profile. Ask 'my full profile' to view all profile details.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 19. MY FATHER / MOTHER NAME ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my father name on record?",
        aliases: [
            "my father name", "my fathers name", "my father's name",
            "my dad name", "father name on my profile",
            "what is my father name", "my guardian name",
            "my emergency contact name",
            "mera papa ka naam", "mera pita ka naam", "mera papa ka naam kya hai",
            "mera father name", "my mother name", "my mom name",
            "my mother's name", "meri maa ka naam", "meri mata ka naam",
        ],
        answer: "👨‍👩‍👦 Family / emergency contact details are stored in your HR profile. Please contact HR to view or update your personal family details.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 20. MY FULL PROFILE / ABOUT ME ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Show my full profile",
        aliases: [
            "my full profile", "show my profile", "my profile",
            "full profile", "profile details", "my details",
            "show my details", "my account details", "my info",
            "all my details", "show all my info", "my complete profile",
            "my profile information", "about me", "mera profile",
            "meri profile", "mujhe mera profile dikhao",
            "mera pura profile", "profile kya hai mera",
            "meri details", "meri info", "meri jankari",
        ],
        answer: "👤 Ask me specifically what you'd like to know:\n\n• My name | My email | My phone\n• My department | My designation | My role\n• My joining date | My experience\n• My TL / Manager | My salary\n• My leave balance | My attendance",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 21. LEAVE POLICY (GENERAL) ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the company leave policy?",
        aliases: [
            "leave policy", "company leave policy", "office leave policy",
            "leave rules", "leave guidelines", "leave structure",
            "how many leaves do we get", "total leaves per year",
            "annual leave policy", "yearly leave policy",
            "what is the leave policy", "tell me the leave policy",
            "explain leave policy", "leave entitlement",
            "how many paid leaves", "paid leave policy",
            "leave types", "types of leave",
            "what types of leave are available", "all leave types",
            "chhuti policy", "leave ke rules", "leave kitne milti hai",
            "kitni chhuti milti hai", "company ki leave policy kya hai",
            "leave policy kya hai", "leave rules kya hai",
            "chhuti ke rules", "leaves per year",
        ],
        answer: "🌴 World WebLogic Leave Policy:\n\n• **Casual Leave (CL):** Short-notice personal leaves\n• **Sick Leave (SL):** Medical / health reasons\n• **Earned Leave (EL):** Earned through months worked\n• **Unpaid Leave (UL):** Beyond entitlement (salary deducted)\n\n📋 Your leave balance: Ask 'my leave balance'\n📅 Leave history: Ask 'my leave history'\n\nFor detailed policy, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 22. CASUAL LEAVE ───────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the casual leave policy?",
        aliases: [
            "casual leave", "casual leave policy", "cl policy",
            "what is casual leave", "how many casual leaves",
            "casual leave rules", "casual leave per year",
            "casual leave limit", "cl rules", "cl limit",
            "cl per year", "casual leave entitlement",
            "casual leave kya hai", "casual leave ke rules",
            "cl kya hota hai", "cl kitni milti hai",
        ],
        answer: "🏖️ Casual Leave (CL) Policy:\n\n• Used for personal or urgent work (non-medical)\n• Requires prior manager approval when possible\n• Cannot usually be carried forward to next year\n\nCheck your current CL balance: Ask 'my leave balance'\nFor exact quota, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 23. SICK LEAVE ─────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the sick leave policy?",
        aliases: [
            "sick leave", "sick leave policy", "sl policy",
            "what is sick leave", "how many sick leaves",
            "sick leave rules", "medical leave", "medical leave policy",
            "health leave", "health leave policy", "sl rules",
            "sl limit", "sl per year", "sick leave entitlement",
            "sick leave limit", "sick leave per year",
            "bimar chhuti", "medical chhuti", "sick leave kya hai",
            "bimari ki chhuti", "sl kya hota hai",
        ],
        answer: "🏥 Sick Leave (SL) Policy:\n\n• For illness or medical emergencies\n• Medical certificate required for 3+ consecutive days\n• Inform your TL / manager at the earliest\n\nCheck your SL balance: Ask 'my leave balance'\nFor exact quota, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 24. EARNED LEAVE ───────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the earned leave policy?",
        aliases: [
            "earned leave", "earned leave policy", "el policy",
            "what is earned leave", "how many earned leaves",
            "annual leave", "privilege leave", "pl policy",
            "el rules", "el limit", "earned leave rules",
            "earned leave per year", "privilege leave policy",
            "carry forward leave", "leave carry forward",
            "can leaves be carried forward", "earned leave balance",
            "el kya hota hai", "earned leave kya hai",
        ],
        answer: "📅 Earned Leave (EL) / Privilege Leave (PL) Policy:\n\n• Accrued based on months of service\n• Can usually be carried forward to the next year (up to a limit)\n• Requires advance planning and manager approval\n\nCheck your EL balance: Ask 'my leave balance'\nFor exact quota and carry-forward rules, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 25. LEAVE APPLICATION PROCESS ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How to apply for leave?",
        aliases: [
            "how to apply leave", "apply for leave", "leave application",
            "how do i apply for leave", "leave application process",
            "how to take leave", "how to request leave",
            "leave request process", "apply leave online",
            "leave application kaise kare", "chhuti kaise le",
            "leave kaise apply kare", "leave apply karna hai",
            "how to submit leave request", "leave form",
            "leave application form", "where to apply leave",
            "leave kaise milti hai", "leave lene ka process",
        ],
        answer: "📝 How to Apply for Leave:\n\n1. Go to the **Leave** section in the employee portal\n2. Click **Apply for Leave**\n3. Select leave type (CL / SL / EL)\n4. Choose start date and end date\n5. Add reason / remarks\n6. Submit – your TL will receive the approval request\n\n📋 Track status: Ask 'my leave history'",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 26. LEAVE ENCASHMENT ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the leave encashment policy?",
        aliases: [
            "leave encashment", "leave encashment policy",
            "can i encash my leaves", "leave cash",
            "encash leaves", "leave money", "leaves encash",
            "can i get money for unused leaves",
            "unused leave payment", "leave payout",
            "leave encashment rules", "leave encashment kya hai",
            "chhuti encash ho sakti hai", "leave ka paisa milega kya",
        ],
        answer: "💰 Leave Encashment Policy:\n\nLeave encashment (converting unused leaves to cash) is subject to HR policy and applicable only in certain circumstances (e.g., resignation, retirement, year-end).\n\nFor your specific encashment eligibility, please contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 27. WORK FROM HOME (WFH) POLICY ────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the work from home policy?",
        aliases: [
            "wfh policy", "work from home policy", "work from home",
            "remote work policy", "remote working policy",
            "can i work from home", "wfh rules", "wfh allowed",
            "is wfh allowed", "work remotely", "remote work",
            "work from home rules", "home office policy",
            "wfh days", "how many wfh days", "wfh eligibility",
            "work from home kya hai", "wfh policy kya hai",
            "ghar se kaam kar sakte hain", "ghar se kaam karna hai",
            "wfh milega kya", "work from home milega",
            "remote work policy kya hai",
        ],
        answer: "🏠 Work From Home (WFH) Policy:\n\nWFH availability depends on your role, department, and manager approval.\n\n• WFH requests must be pre-approved by your TL / Manager\n• Not all roles are eligible for WFH\n• Consistent attendance and performance are required\n\nFor WFH requests, please speak to your manager or contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 28. ATTENDANCE POLICY ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the attendance policy?",
        aliases: [
            "attendance policy", "company attendance policy",
            "office attendance policy", "attendance rules",
            "attendance guidelines", "attendance structure",
            "what is attendance policy", "tell me attendance policy",
            "explain attendance policy", "attendance ke rules",
            "attendance policy kya hai", "attendance rules kya hai",
            "how attendance is tracked", "how is attendance calculated",
            "attendance calculation", "attendance system",
            "how does attendance work", "how is attendance marked",
        ],
        answer: "📊 World WebLogic Attendance Policy:\n\n• **Punch In Deadline:** 10:15 AM (after this = Late mark)\n• **Half Day:** If punch-in is after 10:30 AM\n• **Working Days:** Monday – Friday\n• **Required:** Both punch-in & punch-out daily\n\n⏰ Frequent late arrivals may affect appraisals.\n\nAsk 'my attendance' to check your monthly report.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 29. LATE ARRIVAL POLICY ────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the late arrival policy?",
        aliases: [
            "late arrival policy", "late policy", "late mark policy",
            "what happens if i am late", "late to office policy",
            "late coming policy", "lateness policy",
            "late penalty", "late deduction", "late mark rules",
            "what is late threshold", "late threshold", "late limit",
            "how many times can i be late", "late fine",
            "am i late today", "late aane par kya hoga",
            "late aane ki policy", "late mark kya hota hai",
            "late policy kya hai", "late aane par penalty",
        ],
        answer: "⏰ Late Arrival Policy:\n\n• **On Time:** Punch in by 10:15 AM\n• **Late Mark:** After 10:15 AM\n• **Half Day:** After 10:30 AM\n• Consistent late arrivals are noted and may impact appraisals\n\nAsk 'am I late today' or 'my attendance' to check your status.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 30. HALF DAY POLICY ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the half day policy?",
        aliases: [
            "half day policy", "half day rules", "what is half day",
            "how to apply half day", "half day leave",
            "apply half day leave", "half day application",
            "half day deduction", "half day salary deduction",
            "when is half day marked", "half day mark",
            "half day threshold", "half day timing",
            "half day kya hota hai", "half day policy kya hai",
            "half day lena hai", "half day kaise lete hain",
            "half day ke rules", "half day apply kaise kare",
        ],
        answer: "🌗 Half Day Policy:\n\n• **Half day** is marked if punch-in is after **10:30 AM** (without prior leave approval)\n• You can also apply for a planned half-day leave through the Leave section\n• A half day counts as 0.5 leave days from your balance\n\nApply via the Leave section → Select 'Half Day' option.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 31. SALARY CREDIT DATE ─────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "When is salary credited?",
        aliases: [
            "salary credit date", "when is salary credited",
            "salary date", "salary payment date", "payday",
            "when do we get salary", "when is salary paid",
            "salary disbursement date", "when will salary come",
            "salary credit day", "when is salary deposited",
            "salary kab aayega", "salary kab milti hai",
            "salary kab credit hogi", "salary date kya hai",
            "payday kab hai", "vetan kab milega",
            "when does salary get credited", "salary processing date",
            "salary kab process hoti hai",
        ],
        answer: "💰 Salary is typically credited by the **1st–7th of every month** for the previous month's work.\n\nFor exact salary credit date or delays, please contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 32. PAYSLIP / SALARY SLIP ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How to download my payslip?",
        aliases: [
            "download payslip", "payslip download", "salary slip download",
            "how to get payslip", "get my payslip", "view payslip",
            "my payslip", "my salary slip", "download salary slip",
            "payslip kaise download kare", "salary slip kaise milega",
            "payslip kahan milega", "salary slip kahan dekhe",
            "payslip download karna hai", "payslip mil sakta hai",
        ],
        answer: "💰 To download your payslip:\n\n1. Ask me: **'my payslip for [month]'** (e.g., 'my payslip for April')\n2. I'll show your salary breakdown for that month\n\nOr navigate to the **Payslip** section in the employee portal.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 33. PF (PROVIDENT FUND) ────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the PF policy?",
        aliases: [
            "pf policy", "provident fund", "provident fund policy",
            "pf deduction", "pf contribution", "epf policy",
            "epf deduction", "employee pf", "company pf contribution",
            "pf number", "my pf number", "pf account",
            "pf balance", "pf withdrawal", "pf withdrawal process",
            "how is pf calculated", "pf calculation",
            "pf kya hai", "pf policy kya hai", "pf deduction kya hoti hai",
            "mera pf number", "pf balance kaise dekhe",
            "provident fund kya hota hai",
        ],
        answer: "🏦 Provident Fund (PF) / EPF Policy:\n\n• **Employee Contribution:** 12% of Basic Salary\n• **Employer Contribution:** 12% of Basic Salary\n• Managed under EPFO (Employees' Provident Fund Organisation)\n\nFor your PF account number, UAN, or balance:\n📞 Contact HR or visit https://www.epfindia.gov.in",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 34. ESI / HEALTH INSURANCE ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the health insurance policy?",
        aliases: [
            "esi policy", "esi", "health insurance", "health insurance policy",
            "medical insurance", "mediclaim", "mediclaim policy",
            "employee health insurance", "company health insurance",
            "group health insurance", "ghp", "health cover",
            "insurance policy", "company insurance",
            "esi deduction", "esi benefit", "esi kya hai",
            "health insurance kya hai", "medical insurance policy kya hai",
            "kya health insurance milti hai", "company ki insurance policy",
        ],
        answer: "🏥 Health Insurance / ESI Policy:\n\n• Company provides health coverage for employees\n• ESI (Employee State Insurance) may apply based on salary slab\n• Group Health Insurance may be offered for hospitalisation\n\nFor your specific coverage details, card, or claim process:\n📞 Contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 35. GRATUITY POLICY ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the gratuity policy?",
        aliases: [
            "gratuity policy", "gratuity", "gratuity rules",
            "gratuity amount", "how is gratuity calculated",
            "gratuity eligibility", "when do i get gratuity",
            "gratuity kya hota hai", "gratuity kab milti hai",
            "gratuity policy kya hai",
        ],
        answer: "💵 Gratuity Policy:\n\n• Payable upon completing **5 years** of continuous service\n• Formula: (Last drawn salary × 15 × Years of service) ÷ 26\n• Governed by the Payment of Gratuity Act, 1972\n\nFor gratuity details, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 36. BONUS POLICY ───────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the bonus policy?",
        aliases: [
            "bonus policy", "bonus structure", "annual bonus",
            "performance bonus", "festival bonus", "diwali bonus",
            "salary bonus", "incentive policy", "incentive structure",
            "what bonus do we get", "am i eligible for bonus",
            "bonus eligibility", "bonus amount", "when is bonus given",
            "bonus kya milega", "bonus policy kya hai",
            "bonus kab milega", "incentive kab milega",
            "festival bonus kab milega", "diwali bonus milega kya",
        ],
        answer: "🎁 Bonus Policy:\n\n• **Performance Bonus:** Based on appraisal rating and company performance\n• **Statutory Bonus:** As per the Payment of Bonus Act (8.33% of basic salary for eligible employees)\n• **Festival Bonus:** May be given at festivals (Diwali, etc.) as per company discretion\n\nFor exact bonus details, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 37. APPRAISAL / INCREMENT ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "When is the appraisal cycle?",
        aliases: [
            "appraisal", "appraisal cycle", "appraisal date",
            "appraisal period", "appraisal time", "appraisal month",
            "salary increment", "increment", "increment policy",
            "increment cycle", "when is increment", "salary hike",
            "hike policy", "salary raise", "pay raise",
            "performance appraisal", "annual appraisal",
            "yearly appraisal", "appraisal kab hoga",
            "increment kab milega", "salary hike kab hoga",
            "appraisal policy kya hai", "performance review",
            "kab salary badhegi", "salary review",
        ],
        answer: "📈 Appraisal / Increment Policy:\n\n• Appraisals are typically conducted **annually**\n• Based on performance ratings, attendance, and contribution\n• Increments are effective from the appraisal date\n\nFor the specific cycle and your appraisal status, contact HR or your manager.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 38. NOTICE PERIOD ──────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the notice period?",
        aliases: [
            "notice period", "notice period policy",
            "how many days notice", "notice period rules",
            "notice period duration", "notice period length",
            "resignation notice period", "how long is notice period",
            "1 month notice", "30 days notice", "60 days notice",
            "notice period buyout", "notice period waiver",
            "can notice period be waived", "notice period kya hai",
            "notice period kitne din ka hai", "notice period policy kya hai",
            "company notice period", "exit notice period",
            "notice kitne din ka hai",
        ],
        answer: "📋 Notice Period Policy:\n\n• Standard notice period at World WebLogic is typically **30 days**\n• Notice period may vary based on role/seniority\n• Notice period buyout may be available with manager & HR approval\n\nFor your specific notice period, refer to your offer letter or contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 39. PROBATION PERIOD ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the probation period?",
        aliases: [
            "probation period", "probation period policy",
            "probation duration", "how long is probation",
            "probation rules", "am i on probation",
            "probation period length", "probation period kya hai",
            "probation kitne mahine ka hai", "probation period kitna hota hai",
            "new employee probation", "confirmation period",
        ],
        answer: "📋 Probation Period:\n\n• Standard probation at World WebLogic is typically **3 to 6 months**\n• Performance is reviewed before confirmation\n• Some benefits may differ during probation\n\nFor your specific probation status, check your offer letter or contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 40. HOW TO RESIGN / RESIGNATION PROCESS ────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I resign from the company?",
        aliases: [
            "how to resign", "resignation process", "how to quit",
            "how to leave the company", "resignation letter",
            "how to submit resignation", "exit process",
            "how to exit company", "relieving process",
            "relieving letter", "full and final settlement",
            "fnf settlement", "how to get relieving letter",
            "no dues certificate", "resignation kaise kare",
            "naukri kaise chodhun", "resign karna hai",
            "company kaise chodhun", "resignation process kya hai",
        ],
        answer: "📝 Resignation Process:\n\n1. Submit your resignation letter to your manager and HR\n2. Serve the required **notice period** (typically 30 days)\n3. Complete knowledge transfer and handover\n4. HR will process your **Full & Final (FNF) settlement**\n5. Collect your **Relieving Letter** and **Experience Certificate**\n\nFor the exact exit process, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 41. HR CONTACT ─────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I contact HR?",
        aliases: [
            "hr contact", "hr contact details", "contact hr",
            "hr email", "hr phone", "hr number",
            "hr department", "hr team", "how to reach hr",
            "hr contact info", "hr team contact", "reach hr",
            "who is hr", "hr manager contact", "hr head contact",
            "hr helpdesk", "hr support",
            "hr ka contact", "hr se kaise baat kare",
            "hr ka number", "hr ka email",
            "hr department contact",
        ],
        answer: "📞 To contact HR at World WebLogic:\n\n• **Email:** info@worldweblogic.com\n• **Phone:** +91 120-4545733\n• **Visit:** B 108, 1st Floor, Sector 63, Noida – 201301\n\nFor specific HR queries, raise a support ticket via the Tickets section.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 42. IT HELPDESK / TECH SUPPORT ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I contact IT support?",
        aliases: [
            "it support", "it helpdesk", "tech support",
            "it department", "tech helpdesk", "it contact",
            "technical support", "computer support", "system support",
            "it help", "it team", "tech team",
            "contact it", "how to raise it ticket",
            "laptop issue", "computer issue", "system issue",
            "network issue", "internet issue", "software issue",
            "it support kaise kare", "technical problem kaise solve kare",
            "it team contact", "tech issue kaise report kare",
        ],
        answer: "💻 IT Support / Helpdesk:\n\n• Raise a support ticket via the **Tickets** section in the portal\n• Describe your issue clearly (laptop, network, software, access, etc.)\n• For urgent IT issues, contact your manager or visit the IT desk directly\n\n📧 Email: info@worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 43. DRESS CODE ─────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the office dress code?",
        aliases: [
            "dress code", "office dress code", "company dress code",
            "what to wear to office", "formal dress code",
            "casual friday", "business casual", "smart casual",
            "office attire", "office dress", "uniform policy",
            "what should i wear to office", "dress code policy",
            "dress code kya hai", "office mein kya pehenna chahiye",
            "formal wear policy", "dress code rules",
        ],
        answer: "👔 Office Dress Code:\n\n• **Monday – Thursday:** Business Casual / Formal attire\n• **Friday:** Casual wear allowed\n• Avoid overly casual or inappropriate clothing\n\nFor specific dress code guidelines, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 44. PUBLIC HOLIDAYS / HOLIDAY LIST ─────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What are the public holidays this year?",
        aliases: [
            "holiday list", "public holidays", "holidays this year",
            "company holidays", "office holidays", "holiday calendar",
            "list of holidays", "annual holidays", "national holidays",
            "holiday schedule", "when are the holidays",
            "how many holidays", "total holidays", "optional holidays",
            "restricted holidays", "gazetted holidays",
            "upcoming holidays", "next holiday", "holiday in january",
            "holiday in february", "holiday in march", "holiday in april",
            "holiday in may", "holiday in june", "holiday in july",
            "holiday in august", "holiday in september", "holiday in october",
            "holiday in november", "holiday in december",
            "chutti list", "holidays ki list", "public holiday kab hai",
            "upcoming holiday kab hai", "agla holiday kab hai",
            "company ki holiday list", "office holidays kab kab hai",
        ],
        answer: "📅 For the official Holiday List:\n\nPlease check the **Notice Board** or **HR Portal** for the complete holiday calendar, as it may vary by year.\n\nCommon public holidays include: Republic Day, Holi, Good Friday, Independence Day, Gandhi Jayanti, Dussehra, Diwali, Christmas, and other gazetted holidays as per company policy.\n\nContact HR for the latest holiday schedule.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 45. COMPANY ABOUT / OVERVIEW ───────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Tell me about the company",
        aliases: [
            "about company", "about world weblogic", "company overview",
            "what does world weblogic do", "company description",
            "what is world weblogic", "about our company",
            "company background", "company history", "what do we do",
            "what services does company offer", "company profile",
            "tell me about world weblogic", "what is our company about",
            "company kya karta hai", "company ke baare mein batao",
            "world weblogic kya hai", "hamari company kya karti hai",
            "company ka overview", "company ki jankari",
        ],
        answer: "🏢 About World WebLogic:\n\nWorld WebLogic is a technology and IT services company based in Noida, India.\n\n• **Services:** Web development, mobile apps, digital marketing, IT solutions\n• **Address:** B 108, 1st Floor, Sector 63, Noida – 201301\n• **Website:** https://www.worldweblogic.com\n• **Email:** info@worldweblogic.com\n• **Phone:** +91 120-4545733",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 46. COMPANY FOUNDED / FOUNDING YEAR ────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "When was the company founded?",
        aliases: [
            "company founded", "when was company founded",
            "company founding year", "company start year",
            "company established", "when was world weblogic founded",
            "world weblogic established", "company establishment year",
            "company start date", "company inception",
            "company ki sthapna kab hui", "company kab bani",
            "company kab se hai", "world weblogic kab se hai",
        ],
        answer: "📅 For World WebLogic's founding year and company history, please visit:\n🌐 https://www.worldweblogic.com\n\nOr contact HR for more information about the company's background.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 47. COMPANY SERVICES / WHAT WE DO ──────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What services does World WebLogic provide?",
        aliases: [
            "company services", "what services", "our services",
            "what does our company do", "services we offer",
            "company offerings", "what products we make",
            "what projects we do", "world weblogic services",
            "company work type", "type of work company does",
            "company domain", "our domain", "business domain",
            "what industry are we in", "company industry",
            "hamari company kya kaam karti hai", "company ki services",
            "company kya kaam karta hai",
        ],
        answer: "💼 World WebLogic Services:\n\n• Web Development & Design\n• Mobile Application Development\n• Digital Marketing & SEO\n• IT Consulting & Solutions\n• Custom Software Development\n• UI/UX Design\n\n🌐 Learn more: https://www.worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 48. TDS / INCOME TAX ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is TDS deducted from my salary?",
        aliases: [
            "tds", "tds deduction", "income tax deduction",
            "tax deducted", "tds on salary", "income tax on salary",
            "how is tds calculated", "tds calculation",
            "tax calculation on salary", "form 16",
            "my form 16", "how to get form 16",
            "tds certificate", "tax certificate",
            "tds kya hai", "tds kya hota hai",
            "salary mein tax kitna katega", "tds kitna katega",
            "income tax kya hai", "salary pe tax kaise lagta hai",
        ],
        answer: "📊 TDS / Income Tax on Salary:\n\n• TDS (Tax Deducted at Source) is deducted based on your annual income slab\n• **Form 16** is issued annually for tax filing\n• Investment declarations (80C, HRA, etc.) reduce TDS liability\n\nFor your exact TDS amount and Form 16:\n📞 Contact HR or Accounts team.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 49. OVERTIME POLICY ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the overtime policy?",
        aliases: [
            "overtime policy", "overtime rules", "overtime pay",
            "how is overtime calculated", "overtime eligibility",
            "extra hours policy", "working extra hours",
            "overtime compensation", "can i get paid for overtime",
            "overtime kya hai", "overtime policy kya hai",
            "overtime ka paisa milega", "extra kaam ka paisa",
        ],
        answer: "⏱️ Overtime Policy:\n\nOvertime eligibility and compensation depend on your role and employment type.\n\n• Discuss with your manager before working beyond office hours\n• Salaried employees may have comp-off rather than overtime pay\n\nFor details specific to your role, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 50. COMP-OFF POLICY ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the comp-off policy?",
        aliases: [
            "comp off policy", "compensatory off", "comp off",
            "comp-off rules", "compensatory leave", "extra day off",
            "if i work on weekend", "weekend work compensation",
            "comp off kya hota hai", "comp off milega kya",
            "compensatory off policy", "weekend kaam karne pe chutti milegi",
        ],
        answer: "🗓️ Compensatory Off (Comp-Off) Policy:\n\nIf you work on a declared holiday or weekend:\n• You may be eligible for a **Comp-Off** leave\n• Comp-off must be approved by your manager\n• Must be availed within a defined period (usually 30–60 days)\n\nFor Comp-Off requests, contact your manager or HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 51. REFERRAL PROGRAM ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Is there an employee referral program?",
        aliases: [
            "referral program", "employee referral", "refer a friend",
            "referral bonus", "referral policy", "how to refer someone",
            "employee referral scheme", "referral incentive",
            "can i refer someone", "hire through referral",
            "referral program kya hai", "referral bonus milega kya",
            "kisi ko refer karna hai", "dost ko company mein bulana hai",
        ],
        answer: "🤝 Employee Referral Program:\n\nWorld WebLogic may have an employee referral program for open positions.\n\n• Refer suitable candidates for open roles\n• Referral bonuses (if applicable) are paid upon successful joining and completion of probation\n\nFor current openings and referral guidelines, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 52. TRAINING & DEVELOPMENT ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What training programs are available?",
        aliases: [
            "training programs", "training opportunities",
            "skill development", "learning programs", "upskilling",
            "training policy", "company training", "office training",
            "technical training", "soft skills training",
            "training schedule", "available courses", "company courses",
            "training kya hai", "training kab hogi", "training milegi kya",
            "skill development programs",
        ],
        answer: "📚 Training & Development:\n\nWorld WebLogic encourages continuous learning:\n\n• On-the-job training and mentoring\n• Access to online learning platforms (as available)\n• Internal knowledge-sharing sessions\n\nFor available training programs and schedules, contact HR or your manager.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 53. EMPLOYEE BENEFITS ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What are the employee benefits?",
        aliases: [
            "employee benefits", "company benefits", "perks",
            "what benefits do i get", "company perks",
            "employee perks", "job benefits", "salary benefits",
            "what are the perks", "benefits package",
            "company benefits kya hai", "kya benefits milte hain",
            "perks kya hain", "job mein kya milega",
        ],
        answer: "🎁 Employee Benefits at World WebLogic:\n\n• Competitive salary\n• PF (Provident Fund) contribution\n• Health insurance / ESI (as applicable)\n• Paid leaves (CL, SL, EL)\n• Performance-based appraisals & bonuses\n• Festive bonuses\n• Training & skill development\n\nFor full benefits package, contact HR.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 54. SUPPORT TICKET ─────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I raise a support ticket?",
        aliases: [
            "raise ticket", "raise a ticket", "create ticket",
            "how to raise ticket", "support ticket", "submit ticket",
            "new ticket", "open ticket", "ticket kaise raise kare",
            "ticket kaise banaye", "support kaise le",
            "complaint kaise kare", "issue report karna hai",
            "how to report an issue", "how to report problem",
            "raise support request", "it ticket", "hr ticket",
        ],
        answer: "🎫 How to Raise a Support Ticket:\n\n1. Go to the **Tickets** section in the portal\n2. Click **Create New Ticket**\n3. Select category (IT, HR, Admin, etc.)\n4. Describe your issue\n5. Submit – the assigned team will respond\n\nYou can track your ticket status in the Tickets section.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 55. MY SALARY DETAILS ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my monthly salary?",
        aliases: [
            "my monthly salary", "my salary details", "my ctc",
            "my salary", "my pay", "my compensation",
            "my salary amount", "my basic salary",
            "how much is my salary", "my net salary",
            "my gross salary", "my take home salary",
            "salary details", "my salary breakup",
            "salary breakup", "my salary structure",
            "meri salary", "meri salary kya hai",
            "mujhe meri salary batao", "mera ctc kya hai",
            "mera pay kya hai", "salary kitni hai meri",
            "mera monthly salary", "net salary kya hai",
        ],
        answer: "💰 To see your salary details, ask me:\n\n• 'my salary' – for monthly & per-day breakdown\n• 'my payslip for [month]' – for detailed monthly slip\n\nNote: Salary is visible only after HR releases it.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 56. MY DEPARTMENT ──────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Which department am I in?",
        aliases: [
            "my department", "which department am i in",
            "what department do i belong to", "my dept",
            "my team department", "department name",
            "which dept am i in", "my work department",
            "mera department", "mera department kya hai",
            "main kis department mein hun", "mera vibhag",
        ],
        answer: "🏢 Ask me 'my department' in the chat — I'll look it up directly from your profile.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 57. MY DESIGNATION / ROLE ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my designation?",
        aliases: [
            "my designation", "my job title", "my title",
            "my position", "my role", "what is my designation",
            "what is my role", "my work role", "my job role",
            "my official designation", "my job position",
            "mera designation", "mera designation kya hai",
            "mera role kya hai", "meri position kya hai",
            "main kya hun company mein",
        ],
        answer: "💼 Ask me 'my designation' or 'my role' — I'll fetch it directly from your profile.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 58. MY JOINING DATE ────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "When did I join the company?",
        aliases: [
            "my joining date", "when did i join", "date of joining",
            "my doj", "joining date", "my start date",
            "when i started working", "my first day of work",
            "when did i start", "my first working day",
            "mera joining date", "mera joining kab tha",
            "mujhe joining date batao", "main kab join kiya",
            "joining date kya hai meri",
        ],
        answer: "📅 Ask me 'my joining date' — I'll look it up from your HR profile.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 59. MY EXPERIENCE / TENURE ─────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How long have I been working here?",
        aliases: [
            "my experience", "my tenure", "how long have i worked here",
            "how long i am in company", "my work experience here",
            "years in company", "months in company",
            "how many years with company", "my service length",
            "total experience here", "time spent in company",
            "mera experience", "mera tenure", "main kitne samay se hun",
            "kitne saal se kaam kar raha hun", "experience batao",
        ],
        answer: "🗓️ Ask me 'my experience' or 'how long have I worked here' — I'll calculate your tenure from your joining date.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 60. MY DATE OF BIRTH ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my date of birth?",
        aliases: [
            "my dob", "my date of birth", "my birthday",
            "what is my date of birth", "my birth date",
            "when is my birthday", "what is my dob",
            "mera dob", "mera birthday kya hai",
            "meri date of birth kya hai", "mera janam din",
            "mujhe mera dob batao",
        ],
        answer: "🎂 Ask me 'my date of birth' or 'my dob' — I'll fetch it from your profile.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 61. MY LEAVE BALANCE ───────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is my leave balance?",
        aliases: [
            "my leave balance", "leave balance", "remaining leaves",
            "leaves remaining", "leaves left", "how many leaves do i have",
            "available leaves", "leave quota", "total leaves left",
            "how many leaves are left", "leave days remaining",
            "meri leave balance", "kitni leaves bachi hain",
            "leaves kitni bachi hain", "meri chhuti balance",
            "leave balance kya hai",
        ],
        answer: "📋 Ask me 'my leave balance' — I'll show your total, used, and remaining leaves.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 62. RAISE A GRIEVANCE ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I raise a grievance?",
        aliases: [
            "grievance", "raise grievance", "complaint",
            "raise complaint", "employee grievance",
            "how to complain", "lodge complaint",
            "workplace complaint", "hr grievance",
            "grievance redressal", "grievance policy",
            "shikayat kaise kare", "complaint kaise kare",
            "shikayat darz karna hai",
        ],
        answer: "📝 Raising a Grievance:\n\n1. Speak to your **direct manager** first for minor issues\n2. If unresolved, escalate to **HR**\n3. Raise a formal ticket via the **Tickets** section in the portal (select 'HR' category)\n4. HR will acknowledge and address within defined timelines\n\n📧 Email: info@worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 63. OFFICE WIFI ────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the office WiFi password?",
        aliases: [
            "office wifi", "wifi password", "office wifi password",
            "wifi credentials", "wifi access", "internet password",
            "office internet", "office network", "office wifi name",
            "office ssid", "office ka wifi", "wifi ka password",
            "wifi password kya hai", "office mein wifi password kya hai",
        ],
        answer: "📶 For the office WiFi credentials, please contact the **IT team** or check with your manager.\n\nFor IT-related issues, raise a ticket in the **Tickets** section.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 64. OFFICE PARKING ─────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Is there parking at the office?",
        aliases: [
            "parking", "office parking", "parking available",
            "parking facility", "where to park", "bike parking",
            "car parking", "parking kahan hai", "office mein parking hai kya",
            "parking facility hai kya",
        ],
        answer: "🅿️ For parking availability and facilities at the Sector 63, Noida office, please check with HR or your office admin team directly.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 65. ONBOARDING ─────────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the onboarding process?",
        aliases: [
            "onboarding", "onboarding process", "joining process",
            "new employee process", "how to onboard",
            "what happens on day 1", "first day process",
            "joining formalities", "documentation required",
            "documents for joining", "what documents to bring",
            "onboarding kya hai", "joining mein kya lagta hai",
            "joining documents kya chahiye",
        ],
        answer: "🎉 Onboarding Process at World WebLogic:\n\n1. **Offer Letter** acceptance & document submission\n2. **Background verification** (if applicable)\n3. **Day 1:** Induction, system setup, ID card\n4. Meet your team lead and team members\n5. Complete HR documentation (bank details, PF, etc.)\n\nBring: Photo ID, Address proof, Educational certificates, Previous experience letters, Passport photos.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 66. EXPERIENCE LETTER / CERTIFICATE ────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I get an experience certificate?",
        aliases: [
            "experience certificate", "experience letter",
            "how to get experience letter", "relieving letter",
            "work experience letter", "employment letter",
            "service certificate", "internship certificate",
            "experience letter kaise milega", "relieving letter kaise milega",
            "experience certificate kaise le",
        ],
        answer: "📄 Experience Certificate / Relieving Letter:\n\n• Issued after completing your **notice period** during resignation\n• Or can be requested from HR for specific purposes\n\nFor requests:\n📧 Email: info@worldweblogic.com\n\nOr raise a ticket in the **Tickets** section.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 67. OFFER LETTER ───────────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I get a copy of my offer letter?",
        aliases: [
            "offer letter", "my offer letter", "appointment letter",
            "my appointment letter", "how to get offer letter",
            "copy of offer letter", "duplicate offer letter",
            "offer letter copy chahiye", "appointment letter chahiye",
        ],
        answer: "📄 For a copy of your offer letter or appointment letter:\n\n📧 Email HR at: info@worldweblogic.com\nOr raise a ticket in the **Tickets** section.\n\nHR will provide a copy after verification.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 68. SALARY HIKE NEGOTIATION ────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How to request a salary hike?",
        aliases: [
            "salary hike request", "how to ask for hike",
            "salary increase request", "request for increment",
            "how to negotiate salary", "ask for raise",
            "salary raise request", "salary increment request",
            "hike maangna hai", "salary badhwani hai",
            "increment ke liye kaise bole",
        ],
        answer: "💰 How to Request a Salary Hike:\n\n1. Schedule a meeting with your **manager**\n2. Present your performance, achievements, and contributions\n3. Reference your appraisal rating\n4. If supported by your manager, HR processes the increment\n\nHikes are typically processed during the **annual appraisal cycle**.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 69. COMPANY HEADQUARTERS ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Where is the company headquarters?",
        aliases: [
            "company headquarters", "hq", "company hq",
            "head office", "main office", "company head office",
            "world weblogic headquarters", "world weblogic hq",
            "company ka headquarters", "head office kahan hai",
            "main office kahan hai", "hq kahan hai",
            "registered office", "company registered office",
        ],
        answer: "🏢 World WebLogic Headquarters:\n\nB 108, 1st Floor, Office No. 2nd,\nSector 63, Noida – 201301, Uttar Pradesh, India\n\n🗺️ Near Sector 62 Metro Station (Blue Line)\n📞 +91 120-4545733\n🌐 https://www.worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 70. BANK DETAILS UPDATE ────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How to update my bank details?",
        aliases: [
            "update bank details", "change bank account",
            "how to update bank", "bank details update",
            "change my bank account number", "update account number",
            "bank details change karne hain", "bank account update karna hai",
            "naya bank account add karna hai", "bank details kaise change kare",
        ],
        answer: "🏦 To update your bank details:\n\n1. Go to your **Profile** → **Bank Details** section\n2. Update account number, IFSC, bank name, and branch\n3. Submit for HR verification\n\nOr contact HR directly:\n📧 info@worldweblogic.com",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 71. ID CARD / ACCESS CARD ──────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How do I get my ID card?",
        aliases: [
            "id card", "employee id card", "office id card",
            "access card", "how to get id card", "id card issue",
            "new id card", "duplicate id card", "id card lost",
            "id card kaise milega", "id card kahan se milega",
            "id card banwana hai",
        ],
        answer: "🪪 For your employee ID card:\n\n• New employees receive their ID card during onboarding\n• For a duplicate or lost card, contact HR\n\n📧 Email: info@worldweblogic.com\nOr raise a ticket in the **Tickets** section.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 72. PERFORMANCE REVIEW PROCESS ─────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "How does the performance review work?",
        aliases: [
            "performance review", "performance review process",
            "how is performance evaluated", "performance evaluation",
            "performance assessment", "how to get good appraisal",
            "performance rating", "how performance is rated",
            "performance review kya hai", "performance evaluation kaise hoti hai",
        ],
        answer: "📊 Performance Review Process:\n\n1. **Self Assessment:** Employee fills self-review form\n2. **Manager Review:** Direct manager evaluates performance\n3. **HR Review:** HR finalises rating\n4. **Increment/Bonus:** Based on final rating\n\nKey factors: Attendance, quality of work, deadlines, teamwork, attitude.\n\nFor the next review cycle, check with HR or your manager.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 73. OFFICE NEAR METRO ──────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "Which metro station is near the office?",
        aliases: [
            "nearest metro", "metro near office", "office metro",
            "which metro to take for office", "how to reach office by metro",
            "office metro station", "metro station near office",
            "nearest metro to world weblogic", "metro se kaise pahunche",
            "office kaise jayen metro se", "office ke paas metro",
        ],
        answer: "🚇 Nearest Metro to World WebLogic:\n\n• **Sector 62 Metro Station** (Blue Line)\n• Office is in Sector 63, Noida – 201301\n• Address: B 108, 1st Floor, Office No. 2nd, Sector 63\n\n🗺️ It is a short auto/cab ride from Sector 62 Metro.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 74. REPORTING STRUCTURE ────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What is the reporting structure?",
        aliases: [
            "reporting structure", "org chart", "organisation chart",
            "company hierarchy", "reporting hierarchy",
            "who reports to whom", "management structure",
            "company structure", "chain of command",
            "reporting kya hai", "company structure kya hai",
            "kaun kis ko report karta hai",
        ],
        answer: "🏗️ Reporting Structure at World WebLogic:\n\nEmployees → Team Lead (TL) → Manager → Department Head → Senior Management\n\nFor your specific reporting chain, ask 'who is my TL' or 'who is my manager'.",
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── 75. MY SALARY LAST MONTH ───────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════
    {
        question: "What was my salary last month?",
        aliases: [
            "salary last month", "last month salary", "previous month salary",
            "pichle mahine ki salary", "last month ka salary kya tha",
            "last month payslip", "previous month payslip",
        ],
        answer: "💰 To see your last month's salary, ask:\n\n**'my payslip for [month name]'**\n\nExample: 'my payslip for April'",
    },
];

// ═════════════════════════════════════════════════════════════════════════════
// SEED RUNNER
// ═════════════════════════════════════════════════════════════════════════════

const startPersonalIntentSeed = async () => {
    console.log("🚀 Starting Personal Intent KB seed...");
    console.log(`📦 Total entries to seed: ${entries.length}`);

    // Count total aliases
    const totalAliases = entries.reduce((sum, e) => sum + e.aliases.length, 0);
    console.log(`🔤 Total aliases across all entries: ${totalAliases}`);

    try {
        let seeded = 0;

        for (const entry of entries) {
            await CompanyKB.findOneAndUpdate(
                { question: entry.question },
                { $set: entry },
                { upsert: true, returnDocument: "after" }
            );
            seeded++;
            console.log(`✔ [${seeded}/${entries.length}] Seeded: "${entry.question}" (${entry.aliases.length} aliases)`);
        }

        console.log(`\n✅ Personal Intent KB seeded successfully: ${seeded}/${entries.length} entries`);
        console.log(`🔤 Total searchable aliases: ${totalAliases}`);
    } catch (err) {
        console.error("❌ Personal Intent KB seed error:", err.message);
    }
};

mongoose
    .connect(process.env.MONGO_URI)
    .then(async () => {
        console.log("✅ MongoDB connected");
        await startPersonalIntentSeed();
        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected");
        process.exit(0);
    })
    .catch((err) => {
        console.error("❌ MongoDB connection error:", err.message);
        process.exit(1);
    });

module.exports = { startPersonalIntentSeed };