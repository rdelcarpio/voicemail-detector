/**
 * Voicemail Detector for ElevenLabs Conversational AI
 *
 * Arquitectura:
 * 1. Polling: Consulta API cada 3 segundos para encontrar conversaciones activas
 * 2. Monitor: Conecta WebSocket a cada conversación para monitorear en tiempo real
 * 3. Detección: Analiza transcripciones buscando frases de voicemail
 * 4. Acción: Termina llamadas automáticamente cuando detecta voicemail
 */

require('dotenv').config();
const WebSocket = require('ws');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURACIÓN Y VARIABLES GLOBALES
// ============================================================================

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.AGENT_ID;

// Validar configuración requerida
if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === 'sk_your_api_key_here') {
  console.error('❌ ERROR: ELEVENLABS_API_KEY no está configurado en .env');
  process.exit(1);
}

if (!AGENT_ID || AGENT_ID === 'ag_your_agent_id_here') {
  console.error('❌ ERROR: AGENT_ID no está configurado en .env');
  process.exit(1);
}

// Estado de conversaciones monitoreadas
// Cada entrada contiene: { ws, state, startedAt, ... }
const monitoredConversations = {};

// IDs de conversaciones que ya procesamos (para evitar reconectar)
const knownConversationIds = new Set();

// Array para guardar detecciones de voicemail
let detectedVoicemails = [];

// Lista de frases de voicemail (se carga desde archivo)
let voicemailPhrases = [];

// Intervalo de polling en ms
const POLLING_INTERVAL = 3000; // 3 segundos

// ============================================================================
// FUNCIONES DE CARGA DE FRASES
// ============================================================================

/**
 * Carga las frases de voicemail desde el archivo JSON
 */
function loadVoicemailPhrases() {
  try {
    const filePath = path.join(__dirname, 'voicemail_phrases.json');
    const data = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(data);
    voicemailPhrases = json.phrases || [];
    console.log(`📋 Cargadas ${voicemailPhrases.length} frases de voicemail`);
    return true;
  } catch (error) {
    console.error('❌ Error cargando frases de voicemail:', error.message);
    if (voicemailPhrases.length === 0) {
      voicemailPhrases = [
        'buzón de voz', 'buzon de voz',
        'deje su mensaje', 'deja tu mensaje',
        'después del tono', 'despues del tono',
        'voicemail', 'leave a message',
        'not available', 'no disponible'
      ];
      console.log('⚠️ Usando lista de frases de emergencia');
    }
    return false;
  }
}

// Cargar frases al iniciar
loadVoicemailPhrases();

// Recargar frases cada hora
setInterval(() => {
  console.log('🔄 Recargando frases de voicemail...');
  loadVoicemailPhrases();
}, 3600000);

// ============================================================================
// FUNCIONES DE DETECCIÓN
// ============================================================================

/**
 * Verifica si un texto contiene alguna frase de voicemail
 */
function detectVoicemailPhrase(text) {
  const normalizedText = text.toLowerCase().trim();
  for (const phrase of voicemailPhrases) {
    if (normalizedText.includes(phrase.toLowerCase())) {
      return phrase;
    }
  }
  return null;
}

// ============================================================================
// POLLING DE CONVERSACIONES ACTIVAS
// ============================================================================

/**
 * Consulta la API para obtener conversaciones activas del agente
 */
async function pollActiveConversations() {
  try {
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/convai/conversations`,
      {
        params: {
          agent_id: AGENT_ID,
          page_size: 100
        },
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );

    const conversations = response.data.conversations || response.data || [];

    // Filtrar conversaciones activas (in-progress)
    const activeConversations = conversations.filter(conv =>
      conv.status === 'in-progress' || conv.status === 'initiated'
    );

    // Conectar monitor a conversaciones nuevas
    for (const conv of activeConversations) {
      const convId = conv.conversation_id;

      if (!knownConversationIds.has(convId)) {
        knownConversationIds.add(convId);
        console.log(`\n📱 Nueva conversación detectada: ${convId}`);
        connectToConversationMonitor(convId);
      }
    }

    // Limpiar conversaciones terminadas del set (cada 5 minutos)
    // Se hace en otro interval para no sobrecargar

  } catch (error) {
    if (error.response) {
      console.error(`❌ Error polling conversaciones: ${error.response.status} - ${error.response.data?.detail || error.message}`);
    } else {
      console.error(`❌ Error polling conversaciones: ${error.message}`);
    }
  }
}

// ============================================================================
// MONITOR DE CONVERSACIÓN INDIVIDUAL
// ============================================================================

/**
 * Conecta al WebSocket de monitoreo de una conversación específica
 */
function connectToConversationMonitor(conversationId) {
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversations/${conversationId}/monitor`;

  console.log(`🔌 Conectando monitor a: ${conversationId.slice(-12)}`);

  const ws = new WebSocket(wsUrl, {
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY
    }
  });

  // Inicializar estado de la conversación
  monitoredConversations[conversationId] = {
    ws: ws,
    state: {
      agentHasSpoken: false,
      agentSpokeAt: null,
      lastHumanResponse: null,
      allTranscripts: [],
      startedAt: Date.now()
    }
  };

  // Evento: Conexión establecida
  ws.on('open', () => {
    console.log(`✅ Monitor conectado: ${conversationId.slice(-12)}`);
  });

  // Evento: Mensaje recibido
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      processMonitorMessage(conversationId, message);
    } catch (error) {
      // Algunos mensajes pueden no ser JSON
    }
  });

  // Evento: Error
  ws.on('error', (error) => {
    console.error(`❌ Error monitor ${conversationId.slice(-12)}: ${error.message}`);
  });

  // Evento: Conexión cerrada
  ws.on('close', (code, reason) => {
    console.log(`📴 Monitor cerrado: ${conversationId.slice(-12)} (código: ${code})`);
    cleanupConversation(conversationId);
  });
}

/**
 * Procesa mensajes del monitor de una conversación
 */
function processMonitorMessage(conversationId, message) {
  const conv = monitoredConversations[conversationId];
  if (!conv) return;

  const state = conv.state;
  const eventType = message.type || message.event_type || '';

  // Procesar según tipo de evento
  switch (eventType) {
    case 'user_transcript':
    case 'transcript':
      handleUserTranscript(conversationId, message, state);
      break;

    case 'agent_response':
    case 'assistant_message':
      handleAgentResponse(conversationId, state);
      break;

    case 'conversation_ended':
    case 'call_ended':
      console.log(`📴 [${conversationId.slice(-12)}] Conversación finalizada por el sistema`);
      cleanupConversation(conversationId);
      break;

    case 'ping':
      // Ignorar pings
      break;

    default:
      // Log para debugging de eventos desconocidos
      // console.log(`📨 [${conversationId.slice(-12)}] Evento: ${eventType}`, message);
      break;
  }
}

/**
 * Procesa transcripción del usuario
 */
function handleUserTranscript(conversationId, message, state) {
  const transcript = message.transcript || message.text || message.user_transcription_event?.user_transcript || '';

  if (!transcript) return;

  // Guardar transcripción
  state.allTranscripts.push({
    timestamp: new Date().toISOString(),
    text: transcript
  });

  console.log(`🎤 [${conversationId.slice(-12)}] Usuario: "${transcript}"`);

  // Detectar voicemail por palabras clave
  const detectedPhrase = detectVoicemailPhrase(transcript);

  if (detectedPhrase) {
    console.log(`\n🚨 ========== VOICEMAIL DETECTADO ==========`);
    console.log(`📞 Conversación: ${conversationId}`);
    console.log(`🔍 Frase detectada: "${detectedPhrase}"`);
    console.log(`📝 Transcripción: "${transcript}"`);
    console.log(`⏰ Hora: ${new Date().toISOString()}`);
    console.log(`============================================\n`);

    // Guardar detección
    detectedVoicemails.push({
      conversationId,
      detectedPhrase,
      fullTranscript: transcript,
      method: 'keyword',
      timestamp: new Date().toISOString(),
      allTranscripts: state.allTranscripts
    });

    // Terminar llamada vía WebSocket y API
    endCallViaWebSocket(conversationId);
    endCallViaAPI(conversationId);
    return;
  }

  // Si no es voicemail, marcar como respuesta humana
  state.lastHumanResponse = Date.now();
  console.log(`✅ [${conversationId.slice(-12)}] Respuesta humana válida`);
}

/**
 * Procesa respuesta del agente
 */
function handleAgentResponse(conversationId, state) {
  if (!state.agentHasSpoken) {
    state.agentHasSpoken = true;
    state.agentSpokeAt = Date.now();
    console.log(`🤖 [${conversationId.slice(-12)}] Agente habló`);
  }
}

// ============================================================================
// REVISIÓN PERIÓDICA DE TIMEOUTS
// ============================================================================

/**
 * Revisa conversaciones para detectar timeouts sin respuesta
 */
function checkTimeouts() {
  const now = Date.now();
  const TIMEOUT_MS = 25000; // 25 segundos

  for (const [conversationId, conv] of Object.entries(monitoredConversations)) {
    const state = conv.state;

    // Si el agente habló hace más de 25 segundos y no hay respuesta humana
    if (state.agentSpokeAt &&
        !state.lastHumanResponse &&
        (now - state.agentSpokeAt) > TIMEOUT_MS) {

      console.log(`\n⏰ ========== TIMEOUT SIN RESPUESTA ==========`);
      console.log(`📞 Conversación: ${conversationId}`);
      console.log(`⏱️ Tiempo sin respuesta: ${Math.round((now - state.agentSpokeAt) / 1000)}s`);

      if (state.allTranscripts.length > 0) {
        console.log(`📝 Transcripciones recibidas:`);
        state.allTranscripts.forEach((t, i) => {
          console.log(`   ${i + 1}. "${t.text}"`);
        });

        detectedVoicemails.push({
          conversationId,
          method: 'timeout_with_transcripts',
          needsReview: true,
          timestamp: new Date().toISOString(),
          allTranscripts: state.allTranscripts
        });
      } else {
        detectedVoicemails.push({
          conversationId,
          method: 'timeout_silent',
          timestamp: new Date().toISOString()
        });
      }

      console.log(`=============================================\n`);

      // Terminar llamada
      endCallViaWebSocket(conversationId);
      endCallViaAPI(conversationId);
    }
  }
}

// Revisar timeouts cada 5 segundos
setInterval(checkTimeouts, 5000);

// ============================================================================
// FUNCIONES PARA TERMINAR LLAMADAS
// ============================================================================

/**
 * Termina llamada enviando comando por WebSocket
 */
function endCallViaWebSocket(conversationId) {
  const conv = monitoredConversations[conversationId];
  if (conv && conv.ws && conv.ws.readyState === WebSocket.OPEN) {
    try {
      conv.ws.send(JSON.stringify({ type: 'end_call' }));
      console.log(`📤 [${conversationId.slice(-12)}] Comando end_call enviado por WebSocket`);
    } catch (error) {
      console.error(`❌ Error enviando end_call: ${error.message}`);
    }
  }
}

/**
 * Termina llamada vía API REST como respaldo
 */
async function endCallViaAPI(conversationId) {
  try {
    await axios.post(
      `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}/end_session`,
      {},
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`✅ [${conversationId.slice(-12)}] Llamada terminada vía API`);
  } catch (error) {
    // Es normal que falle si ya se cerró por WebSocket
    if (error.response?.status !== 404 && error.response?.status !== 400) {
      console.error(`❌ Error API end_session: ${error.response?.status || error.message}`);
    }
  }

  // Limpiar conversación
  cleanupConversation(conversationId);
}

/**
 * Limpia una conversación de la memoria
 */
function cleanupConversation(conversationId) {
  const conv = monitoredConversations[conversationId];
  if (conv) {
    if (conv.ws) {
      try {
        conv.ws.close();
      } catch (e) {}
    }
    delete monitoredConversations[conversationId];
  }
}

// Limpiar IDs conocidos cada 10 minutos para evitar memory leak
setInterval(() => {
  const threshold = Date.now() - (10 * 60 * 1000); // 10 minutos
  // Solo mantener las conversaciones activas en knownConversationIds
  for (const convId of knownConversationIds) {
    if (!monitoredConversations[convId]) {
      knownConversationIds.delete(convId);
    }
  }
}, 600000);

// ============================================================================
// SISTEMA DE LOGS
// ============================================================================

/**
 * Guarda las detecciones en archivo JSON
 */
function saveVoicemailLog() {
  if (detectedVoicemails.length === 0) {
    return;
  }

  const filename = `voicemail_log_${Date.now()}.json`;
  const filePath = path.join(__dirname, filename);

  try {
    const logData = {
      savedAt: new Date().toISOString(),
      totalDetections: detectedVoicemails.length,
      detections: detectedVoicemails
    };

    fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
    console.log(`\n💾 Log guardado: ${filename} (${detectedVoicemails.length} detecciones)`);

    // Resumen por método
    const byMethod = {};
    detectedVoicemails.forEach(d => {
      byMethod[d.method] = (byMethod[d.method] || 0) + 1;
    });
    Object.entries(byMethod).forEach(([method, count]) => {
      console.log(`   • ${method}: ${count}`);
    });

    detectedVoicemails = [];
  } catch (error) {
    console.error(`❌ Error guardando log: ${error.message}`);
  }
}

// Guardar logs cada hora
setInterval(saveVoicemailLog, 3600000);

// ============================================================================
// MANEJO DE CIERRE
// ============================================================================

function cleanup() {
  console.log(`\n🛑 Cerrando servidor...`);

  // Guardar logs pendientes
  if (detectedVoicemails.length > 0) {
    saveVoicemailLog();
  }

  // Cerrar todos los WebSockets
  for (const conv of Object.values(monitoredConversations)) {
    if (conv.ws) {
      try { conv.ws.close(); } catch (e) {}
    }
  }

  console.log(`👋 Servidor cerrado`);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

process.on('uncaughtException', (error) => {
  console.error(`❌ Error no capturado: ${error.message}`);
});

process.on('unhandledRejection', (reason) => {
  console.error(`❌ Promise rechazada:`, reason);
});

// ============================================================================
// INICIO DEL SERVIDOR
// ============================================================================

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎯 VOICEMAIL DETECTOR - ElevenLabs Conversational AI   ║
║                                                           ║
║   Arquitectura:                                           ║
║   • Polling cada ${POLLING_INTERVAL/1000}s para detectar conversaciones        ║
║   • Monitor WebSocket individual por conversación         ║
║   • Detección por palabras clave + timeout                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

console.log(`📋 Configuración:`);
console.log(`   Agent ID: ${AGENT_ID}`);
console.log(`   Frases cargadas: ${voicemailPhrases.length}`);
console.log(`   Polling interval: ${POLLING_INTERVAL/1000} segundos`);
console.log(`   Timeout sin respuesta: 25 segundos`);
console.log(`\n🚀 Iniciando polling de conversaciones...\n`);

// Iniciar polling
pollActiveConversations();
setInterval(pollActiveConversations, POLLING_INTERVAL);

console.log(`✅ Servidor activo - Monitoreando conversaciones del agente`);
console.log(`   Esperando llamadas entrantes...\n`);
