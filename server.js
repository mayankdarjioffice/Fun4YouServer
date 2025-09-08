const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// NEW: Body parser middleware to handle POST requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cors());

// --- Firebase Admin SDK Initialization ---
const serviceAccount = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();
// --- END Firebase Admin SDK Initialization ---


/**
 * Generates a themed (Light/Dark) HTML page with a conditional style.
 * @param {string} status - The status type ('success', 'warning', 'error', 'password')
 * @param {string} title - The main title of the message.
 * @param {string} message - A descriptive message.
 * @param {object|null} details - An object with details to display.
 * @param {string} token - The redemption token, needed for the password form.
 * @returns {string} A full HTML page as a string.
 */
const generateHtmlResponse = (status, title, message, details = null, token = null) => {
    const icons = {
        success: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle class="icon__circle" cx="26" cy="26" r="25" fill="none"/><path class="icon__check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/></svg>`,
        warning: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><path class="icon__triangle" d="M26,2 L2,48 L50,48 Z" fill="none"/><line class="icon__line" x1="26" y1="20" x2="26" y2="34" stroke-linecap="round"/><line class="icon__line" x1="26" y1="40" x2="26" y2="40" stroke-linecap="round"/></svg>`,
        error: `<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><circle class="icon__circle_error" cx="26" cy="26" r="25" fill="none"/><path class="icon__cross_1" d="M16 16 36 36" /><path class="icon__cross_2" d="M36 16 16 36" /></svg>`,
        password: `<svg class="icon password-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lock-keyhole"><path d="M12 2C9.24 2 7 4.24 7 7v4H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-3V7c0-2.76-2.24-5-5-5z"/><circle cx="12" cy="12" r="2"/></svg>`
    };

    let detailsHtml = '';
    if (details) {
        const playerName = details['Player'];
        if (playerName) {
            detailsHtml += `<p class="player-name">${playerName}</p>`;
        }
        detailsHtml += '<div class="details">';
        for (const [key, value] of Object.entries(details)) {
            if (key !== 'Player') {
                detailsHtml += `<p><strong>${key}:</strong> <span>${value}</span></p>`;
            }
        }
        detailsHtml += '</div>';
    }

    const passwordForm = `
        <form action="/redeem" method="POST" class="password-form">
            <input type="hidden" name="token" value="${token}">
            <input type="password" name="password" placeholder="Enter Admin Password" required autofocus />
            <button type="submit">Unlock</button>
        </form>
    `;

    // Conditional styling and structure based on status
    const isPasswordPage = status === 'password';
    
    // Select correct card class and button text based on status
    const cardClass = isPasswordPage ? 'card' : 'ticket';
    const headerClass = isPasswordPage ? 'card-header' : 'ticket-header';
    const bodyClass = isPasswordPage ? 'card-body' : '';
    const buttonText = isPasswordPage ? 'Unlock' : 'Done';

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>Voucher Status</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');

            /* --- THEME IMPLEMENTATION --- */
            :root {
                --success-color: #28a745;
                --warning-color: #ffc107;
                --error-color: #dc3545;

                /* Light Mode Default Theme */
                --page-bg-start: #ffffff;
                --page-bg-end: #e0e0e0;
                --ticket-bg: #ffffff;
                --card-bg: rgba(255, 255, 255, 0.4);
                --text-primary: #222222;
                --text-secondary: #555555;
                --details-bg: #f9f9f9;
                --details-text-strong: #000000;
                --border-color: #e0e0e0;
                --shadow-color: rgba(0, 0, 0, 0.12);
                --password-color: #f97316; /* orange for password page */
                --password-color-dark: #f59e0b; /* darker orange */
                --password-icon-glow: rgba(249, 115, 22, 0.4);
                --password-border-glow: rgba(249, 115, 22, 0.8);
            }

            /* Dark Mode Theme via Media Query */
            @media (prefers-color-scheme: dark) {
                :root {
                    --page-bg-start: #1e1e1e;
                    --page-bg-end: #0a0a0a;
                    --ticket-bg: #1e1e1e;
                    --card-bg: rgba(31, 41, 55, 0.6); /* Semi-transparent for glassmorphism */
                    --text-primary: #e0e0e0;
                    --text-secondary: #a0a0a0;
                    --details-bg: #2c2c2e;
                    --details-text-strong: #ffffff;
                    --border-color: #444444;
                    --shadow-color: rgba(0, 0, 0, 0.4);
                    --password-color: #a78bfa; /* purple for password page */
                    --password-color-dark: #8b5cf6; /* darker purple */
                    --password-icon-glow: rgba(167, 139, 250, 0.6);
                    --password-border-glow: rgba(167, 139, 250, 0.9);
                }
            }

            body {
                font-family: 'Inter', sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, var(--page-bg-start) 0%, var(--page-bg-end) 100%);
                transition: background 0.3s ease;
            }
            body.success { --primary-color: var(--success-color); }
            body.warning { --primary-color: var(--warning-color); }
            body.error   { --primary-color: var(--error-color); }
            body.password { --primary-color: var(--password-color); }

            /* --- TICKET STYLE (for status pages) --- */
            .ticket {
                background: var(--ticket-bg);
                width: 350px;
                max-width: 90%;
                border-radius: 16px;
                box-shadow: 0 10px 30px var(--shadow-color);
                text-align: center;
                padding: 30px 25px;
                position: relative;
                animation: slide-in 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
            }
            .ticket::before, .ticket::after {
                content: '';
                position: absolute;
                width: 30px;
                height: 30px;
                background: var(--page-bg-start); /* Match background for seamless look */
                border-radius: 50%;
                top: 50%;
                transform: translateY(-50%);
            }
            .ticket::before { left: -15px; }
            .ticket::after { right: -15px; }

            .ticket-header {
                border-bottom: 2px dashed var(--border-color);
                padding-bottom: 20px;
                margin-bottom: 20px;
            }

            /* --- CARD STYLE (for password page) --- */
            .card {
                background: var(--card-bg);
                width: 350px;
                max-width: 90%;
                border-radius: 20px;
                border: 2px solid var(--password-border-glow);
                box-shadow: 0 10px 30px var(--shadow-color);
                text-align: center;
                animation: glass-in 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
            }
            
            .card-header {
                background: transparent;
                padding: 30px 25px;
            }
            .card-body {
                padding: 25px;
                color: var(--text-primary);
            }
            
            /* --- COMMON STYLES --- */
            @keyframes slide-in {
                0% { transform: translateY(50px); opacity: 0; }
                100% { transform: translateY(0); opacity: 1; }
            }
            @keyframes glass-in {
                0% { transform: translateY(50px) scale(0.9); opacity: 0; }
                100% { transform: translateY(0) scale(1); opacity: 1; }
            }

            .icon {
                width: 80px;
                height: 80px;
                margin: 0 auto 15px;
            }
            .icon__circle { stroke-dasharray: 166; stroke-dashoffset: 166; stroke-width: 2; stroke: var(--primary-color); animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards; }
            .icon__check { stroke-dasharray: 48; stroke-dashoffset: 48; stroke-width: 3; stroke: var(--primary-color); stroke-linecap: round; stroke-linejoin: round; animation: stroke 0.3s cubic-bezier(0.65, 0, 0.45, 1) 0.8s forwards; }
            .icon__triangle { stroke-width: 3; stroke: var(--primary-color); stroke-linecap: round; stroke-linejoin: round; animation: draw-triangle 0.7s ease-out forwards; }
            .icon__line { stroke-width: 3; stroke: var(--primary-color); animation: pulse 1.5s infinite ease-in-out; }
            @keyframes draw-triangle { 0% { stroke-dasharray: 0 150; } 100% { stroke-dasharray: 150 150; } }
            @keyframes pulse { 0%, 100% { opacity: 0.5; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.05); } }
            .icon__circle_error { stroke-dasharray: 166; stroke-dashoffset: 166; stroke-width: 2; stroke: var(--primary-color); animation: stroke 0.6s cubic-bezier(0.65, 0, 0.45, 1) forwards; }
            .error .ticket { animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both; }
            .icon__cross_1, .icon__cross_2 { stroke-width: 3; stroke: var(--primary-color); stroke-linecap: round; transform-origin: center; opacity: 0; }
            .icon__cross_1 { animation: draw-cross 0.3s 0.7s ease-out forwards; }
            .icon__cross_2 { animation: draw-cross 0.3s 0.9s ease-out forwards; }
            @keyframes stroke { 100% { stroke-dashoffset: 0; } }
            @keyframes shake { 10%, 90% { transform: translate3d(-1px, 0, 0); } 20%, 80% { transform: translate3d(2px, 0, 0); } 30%, 50%, 70% { transform: translate3d(-4px, 0, 0); } 40%, 60% { transform: translate3d(4px, 0, 0); } }
            @keyframes draw-cross { to { opacity: 1; } }
            
            .password-icon {
                filter: drop-shadow(0 0 8px var(--password-icon-glow));
                transition: filter 0.3s ease;
            }
            .title {
                font-size: 26px;
                font-weight: 800;
                margin: 0;
            }
            .message {
                font-size: 16px;
                margin-top: 8px;
            }
            .ticket-header .title { color: var(--text-primary); }
            .ticket-header .message { color: var(--text-secondary); }
            .card-header .title, .card-header .message { color: var(--text-primary); }

            .player-name {
                font-size: 22px;
                font-weight: 600;
                color: var(--primary-color);
                margin: 0 0 15px 0;
            }
            .details {
                text-align: left;
                font-size: 15px;
                color: var(--text-secondary);
                background: var(--details-bg);
                padding: 15px;
                border-radius: 8px;
            }
            .details p {
                margin: 8px 0;
                display: flex;
                justify-content: space-between;
            }
            .details strong {
                font-weight: 600;
                color: var(--text-primary);
            }
            .details span {
                font-weight: 600;
                color: var(--details-text-strong);
            }
            .details a {
                color: var(--details-text-strong);
                text-decoration: none;
                cursor: default;
            }
            .done-button {
                margin-top: 25px;
                width: 100%;
                padding: 15px;
                border: none;
                border-radius: 8px;
                background-color: var(--primary-color);
                color: white;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .done-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 10px rgba(0,0,0,0.15);
            }

            /* NEW: Styles for the password form */
            .password-form {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
                padding: 20px 0;
            }
            .password-form input {
                width: 100%;
                padding: 15px;
                border-radius: 50px; /* Pill shape */
                border: 2px solid var(--border-color);
                background-color: transparent;
                color: var(--text-primary);
                text-align: center;
                font-size: 18px;
                font-weight: 600;
                transition: border-color 0.3s, box-shadow 0.3s;
            }
            .password-form input:focus {
                outline: none;
                border-color: var(--primary-color);
                box-shadow: 0 0 0 3px var(--password-border-glow);
            }
            .password-form button {
                width: 100%;
                padding: 15px;
                border: none;
                border-radius: 50px; /* Pill shape */
                background: linear-gradient(90deg, var(--password-color), var(--password-color-dark));
                color: white;
                font-size: 18px;
                font-weight: 800;
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s, background 0.3s;
            }
            .password-form button:hover {
                transform: translateY(-2px);
                box-shadow: 0 8px 20px var(--password-border-glow);
            }
            .password-form button:active {
                transform: translateY(2px);
                box-shadow: 0 2px 5px var(--password-border-glow);
            }
        </style>
    </head>
    <body class="${status}">
        ${isPasswordPage ? `
        <div class="card">
            <div class="card-header">
                ${icons[status] || ''}
                <h1 class="title">${title}</h1>
                <p class="message">${message}</p>
            </div>
            <div class="card-body">
                ${passwordForm}
            </div>
        </div>
        ` : `
        <div class="ticket">
            <div class="ticket-header">
                ${icons[status] || ''}
                <h1 class="title">${title}</h1>
                <p class="message">${message}</p>
            </div>
            ${detailsHtml}
            <button class="done-button" onclick="window.close();">Done</button>
        </div>
        `}
    </body>
    </html>
    `;
};

app.get('/redeem', async (req, res) => {
    const token = req.query.token;
    if (!token) {
        return res.status(400).send(generateHtmlResponse('error', 'Error', 'No token was provided.'));
    }
    // Present the password form on initial GET request
    return res.send(generateHtmlResponse('password', 'Admin Access', 'Enter the password to redeem voucher details.', null, token));
});

app.post('/redeem', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
        return res.status(400).send(generateHtmlResponse('error', 'Error', 'Invalid request. Missing token or password.'));
    }

    try {
        const appId = process.env.FIREBASE_PROJECT_ID || 'default-app-id';

        // Fetch the stored admin password from Firestore
        const adminPasswordDocRef = db.doc(`artifacts/${appId}/public/data/adminSettings/password`);
        const adminPasswordDoc = await adminPasswordDocRef.get();
        const storedAdminPassword = adminPasswordDoc.exists ? adminPasswordDoc.data().adminPassword : 'Fun4You@2025';

        // Check if the provided password is correct
        if (password !== storedAdminPassword) {
            return res.status(401).send(generateHtmlResponse('error', 'Invalid Password', 'The password you entered is incorrect.', null, token));
        }

        // Proceed with redemption logic
        const entriesRef = db.collection(`artifacts/${appId}/public/data/entries`);
        const snapshot = await entriesRef.where('redemptionToken', '==', token).limit(1).get();

        if (snapshot.empty) {
            return res.status(404).send(generateHtmlResponse('error', 'Not Found', 'No entry was found for this token.'));
        }

        const entryDoc = snapshot.docs[0];
        const entryData = entryDoc.data();

        if (!entryData.isRedeemed) {
            const redemptionTime = admin.firestore.FieldValue.serverTimestamp();
            
            await entryDoc.ref.update({ 
                isRedeemed: true,
                redeemedAt: redemptionTime 
            });
            
            const updatedEntryDoc = await entryDoc.ref.get();
            const updatedEntryData = updatedEntryDoc.data();
            const formattedTime = updatedEntryData.redeemedAt.toDate().toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const redemptionDetails = {
                Player: entryData.name,
                'Mobile Number': entryData.mobileNumber,
                'Redeemed On': formattedTime
            };
            
            return res.send(generateHtmlResponse('success', 'Redeemed Successfully!', 'This voucher is now valid.', redemptionDetails));
        } else {
            const originalRedemptionTime = entryData.redeemedAt.toDate();
            
            const formattedTime = originalRedemptionTime.toLocaleString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const redemptionDetails = {
                Player: entryData.name,
                'Mobile Number': entryData.mobileNumber,
                'Redeemed On': formattedTime
            };
            
            return res.send(generateHtmlResponse('warning', 'Already Redeemed', 'This voucher has already been used.', redemptionDetails));
        }
    } catch (error) {
        console.error('Error redeeming voucher:', error);
        return res.status(500).send(generateHtmlResponse('error', 'Server Error', 'Failed to process the voucher.'));
    }
});

app.listen(port, () => {
    console.log(`Redemption server listening on port ${port}`);
});