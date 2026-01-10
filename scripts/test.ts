import fs from 'fs';
import fetch from 'node-fetch'; // npm install node-fetch@3

// chemins
const promptPath = '/home/luciedefraiteur/.ragforge/logs/llm-calls/ResearchAgent.iterate/2025-12-17T18-29-37-416+01-00/prompt.txt';
const outputPath = './response.txt';

// lis le prompt
const promptData = fs.readFileSync(promptPath, 'utf-8');

// payload JSON pour Ollama
const payload = {
  model: 'gemma3:12b-it-qat',
  messages: [
    { role: 'user', content: promptData }
  ]
};

async function run() {
  try {
    const res = await fetch('http://192.168.1.59:11434/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const json = await res.json();

    // récupère juste le texte de l'assistant
    const assistantText = json.choices?.[0]?.message?.content || '';

    fs.writeFileSync(outputPath, assistantText, 'utf-8');
    console.log('Réponse écrite dans', outputPath);
  } catch (err) {
    console.error('Erreur:', err);
  }
}

run();
