const generateCelebrationTemplate = ({
    style,
    employee,
    customMessage,
    eventType,
    uploadedImage
}) => {

    const EMAIL_THEMES = {

        dark_purple: {
            bannerBg: "linear-gradient(155deg,#0f0b2e 0%,#1e1260 55%,#0f0b2e 100%)",
            logoBg: "rgba(255,255,255,0.12)",
            logoColor: "#e0d9ff",
            avatarBg: "rgba(255,255,255,0.18)",
            avatarColor: "#fff",
            headingColor: "#ffffff",
            accentColor: "#a78bfa",
            bodyBg: "#ffffff",
        },

        corporate_blue: {
            bannerBg: "linear-gradient(155deg,#0c2d6b 0%,#1d5fcc 55%,#0c2d6b 100%)",
            logoBg: "rgba(255,255,255,0.12)",
            logoColor: "#bfdbfe",
            avatarBg: "rgba(255,255,255,0.2)",
            avatarColor: "#fff",
            headingColor: "#ffffff",
            accentColor: "#60a5fa",
            bodyBg: "#ffffff",
        },

        warm_gold: {
            bannerBg: "linear-gradient(155deg,#78350f 0%,#b45309 55%,#78350f 100%)",
            logoBg: "rgba(255,255,255,0.15)",
            logoColor: "#fde68a",
            avatarBg: "rgba(255,255,255,0.2)",
            avatarColor: "#fff",
            headingColor: "#fef3c7",
            accentColor: "#fbbf24",
            bodyBg: "#ffffff",
        },

        light_minimal: {
            bannerBg: "linear-gradient(155deg,#f5f3ff 0%,#ede9fe 55%,#f5f3ff 100%)",
            logoBg: "#ede9fe",
            logoColor: "#5b21b6",
            avatarBg: "#ddd6fe",
            avatarColor: "#4c1d95",
            headingColor: "#3b0764",
            accentColor: "#7c3aed",
            bodyBg: "#ffffff",
        },
    };

    const t =
        EMAIL_THEMES[style] ||
        EMAIL_THEMES.dark_purple;

    const initials =
        employee?.name
            ?.split(" ")
            .map(n => n[0])
            .join("")
            .slice(0, 2)
            .toUpperCase() || "DP";

    const heading =
        eventType === "birthday"
            ? "HAPPY BIRTHDAY"
            : eventType === "anniversary"
                ? "HAPPY ANNIVERSARY"
                : "CONGRATULATIONS";

    const subHeading =
        eventType === "birthday"
            ? "Wishing you a great birthday and a memorable year."
            : eventType === "anniversary"
                ? "Thank you for your dedication and continued excellence."
                : "You deserve this recognition!";

    const bodyMsg =
        customMessage ||
        "Wishing you happiness, success, and many wonderful moments ahead.";

    return `

    <div style="
        background:#f3f4f6;
        padding:30px;
        font-family:Arial,sans-serif;
    ">

        <div style="
            max-width:420px;
            margin:0 auto;
            border-radius:12px;
            overflow:hidden;
            box-shadow:0 4px 16px rgba(0,0,0,0.10);
            background:#fff;
        ">

            <!-- BANNER -->

            <div style="
                background:${t.bannerBg};
                padding:28px 18px;
                text-align:center;
            ">

                <!-- LOGO -->

                <div style="
                    display:inline-block;
                    background:${t.logoBg};
                    border-radius:6px;
                    padding:4px 10px;
                    margin-bottom:14px;
                ">
                    <span style="
                        font-size:10px;
                        font-weight:800;
                        letter-spacing:2px;
                        color:${t.logoColor};
                        text-transform:uppercase;
                    ">
                        WORLD WEBLOGIC PVT.LTD
                    </span>
                </div>

                <!-- HEADING -->

                <div style="
                    font-size:30px;
                    font-weight:900;
                    color:${t.headingColor};
                    line-height:1;
                    margin-bottom:6px;
                ">
                    ${heading}
                </div>

                <!-- LINE -->

                <div style="
                    width:45px;
                    height:3px;
                    background:${t.accentColor};
                    border-radius:4px;
                    margin:10px auto 18px;
                "></div>

                <!-- SUBHEADING -->

                <p style="
                    font-size:12px;
                    color:${t.headingColor};
                    opacity:0.85;
                    line-height:1.6;
                    margin-bottom:18px;
                ">
                    ${subHeading}
                </p>



              <!-- AVATAR -->

<div style="
    width:75px;
    height:75px;
    border-radius:50%;
    overflow:hidden;
    background:${t.avatarBg};
    border:3px solid ${t.accentColor};
    margin:0 auto 14px;
    display:flex;
    align-items:center;
    justify-content:center;
">

    ${uploadedImage
            ? `
                <img
                    src="${uploadedImage}"
                    alt="${employee?.name}"
                    style="
                        width:100%;
                        height:100%;
                        object-fit:cover;
                    "
                />
            `
            : `
                <span style="
                    font-size:24px;
                    font-weight:800;
                    color:${t.avatarColor};
                ">
                    ${initials}
                </span>
            `
        }

</div>

                <!-- NAME -->

                <p style="
                    font-size:16px;
                    font-weight:800;
                    color:${t.headingColor};
                    letter-spacing:1px;
                    margin-bottom:3px;
                    text-transform:uppercase;
                ">
                    ${employee?.name || "Employee"}
                </p>

                <!-- DESIGNATION -->

                <p style="
                    font-size:11px;
                    color:${t.accentColor};
                    letter-spacing:1px;
                ">
                    ${employee?.designation || "Employee"}
                </p>

            </div>

            <!-- BODY -->

            <div style="
                background:${t.bodyBg};
                padding:20px 18px;
                border-top:3px solid ${t.accentColor};
            ">

                <p style="
                    font-size:13px;
                    color:#374151;
                    line-height:1.8;
                ">
                    ${bodyMsg}
                </p>

                <p style="
                    font-size:13px;
                    color:#374151;
                    margin-top:12px;
                ">
                    Enjoy your special day to the fullest 🥳✨
                </p>

            </div>

            <!-- FOOTER -->

            <div style="
                background:#f9fafb;
                padding:14px 18px;
                border-top:1px solid #f3f4f6;
            ">

                <p style="
                    font-size:11px;
                    color:#6b7280;
                    font-style:italic;
                    margin-bottom:4px;
                ">
                    Thanks & Regards
                </p>

                <p style="
                    font-size:13px;
                    font-weight:700;
                    color:#111827;
                    margin-bottom:3px;
                ">
                    HR Department
                </p>

                <p style="
                    font-size:11px;
                    color:#374151;
                ">
                    World WebLogic Pvt. Ltd.
                </p>

            </div>

        </div>

    </div>

    `;
};

module.exports = generateCelebrationTemplate;