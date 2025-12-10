Nouveau design document/inspiration pour les temps d'attente de l'agent:

<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Daemon Code Summoning</title>
    <style>
        body {
            background-color: #050505; /* Noir profond */
            color: #ff3333; /* Rouge démon */
            font-family: 'Courier New', Courier, monospace;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-shadow: 0 0 5px #ff0000, 0 0 10px #8b0000; /* Effet Glow */
        }
        .container {
            width: 80%;
            max-width: 800px;
            text-align: left;
        }
        h2 {
            border-bottom: 1px solid #333;
            padding-bottom: 10px;
            color: #666;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 2px;
        }
        .terminal-line {
            font-size: 1.5rem;
            margin-bottom: 40px;
            white-space: pre; /* Important pour garder les espaces */
        }
    </style>
</head>
<body>

<div class="container">
    <h2>Option 1 : Le Cercle (Rotation)</h2>
    <div id="anim1" class="terminal-line"></div>

    <h2>Option 2 : Transmutation (Focus central)</h2>
    <div id="anim2" class="terminal-line"></div>

    <h2>Option 3 : Le Glitch (Chaos Mathématique)</h2>
    <div id="anim3" class="terminal-line"></div>
</div>

<script>
    // --- ANIMATION 1 : LE CERCLE ---
    const runes = ["᚛", "ᚨ", "ᛒ", "ᛟ", "᚜", "⸸", "‡"];
    const center = "⛧";
    let idx1 = 0;
    
    setInterval(() => {
        // Rotation du tableau
        const rotated = [...runes.slice(idx1), ...runes.slice(0, idx1)];
        const left = rotated.slice(0, 3).join("");
        const right = rotated.slice(rotated.length - 3).join("");
        
        document.getElementById('anim1').innerText = `⟪ ${left} ${center} ${right} ⟫ INVOCATION DU CODE...`;
        
        idx1 = (idx1 + 1) % runes.length;
    }, 150);


    // --- ANIMATION 2 : TRANSMUTATION ---
    const alchSymbols = ["⍟", "🜂", "☿", "☉", "♄", "🜄", "∮"];
    let idx2 = 0;

    setInterval(() => {
        const sym = alchSymbols[idx2];
        document.getElementById('anim2').innerText = `⁅ ⸸ ⁆—[ ${sym} ]—⁅ ⸸ ⁆ ANALYSE EN COURS...`;
        idx2 = (idx2 + 1) % alchSymbols.length;
    }, 200);


    // --- ANIMATION 3 : GLITCH DAEMON ---
    const techRunes = ["∇", "∫", "∃", "∀", "∴", "∵", "⊕", "⊗", "⌇"];
    const core = "⛧";

    setInterval(() => {
        const r1 = techRunes[Math.floor(Math.random() * techRunes.length)];
        const r2 = techRunes[Math.floor(Math.random() * techRunes.length)];
        const r3 = techRunes[Math.floor(Math.random() * techRunes.length)];
        
        const variants = [
            `[${r1} ${core} ${r2}] ...COMPILING CURSE...`,
            `❬${r1}${r2} ${core} ${r3}❭ ...SUMMONING COMPILER...`,
            ` ${r1} ⸢${core}⸣ ${r2}  ...PARSING SOULS...`
        ];
        
        document.getElementById('anim3').innerText = variants[Math.floor(Math.random() * variants.length)];
    }, 100); // Plus rapide pour l'effet glitch

</script>

</body>
</html>