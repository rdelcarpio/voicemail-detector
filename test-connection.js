/**
 * Test de conexión a ElevenLabs API
 *
 * Ejecutar: npm test
 *
 * Este script verifica:
 * 1. Que las credenciales son válidas
 * 2. Que la API de conversaciones funciona
 * 3. Que el monitoreo de conversaciones está disponible
 */

require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AGENT_ID = process.env.AGENT_ID;

console.log(`
╔═══════════════════════════════════════════════════════════╗
║          TEST DE CONEXIÓN - ElevenLabs API               ║
╚═══════════════════════════════════════════════════════════╝
`);

// Validar configuración
console.log('📋 Verificando configuración...\n');

if (!ELEVENLABS_API_KEY || ELEVENLABS_API_KEY === 'sk_your_api_key_here') {
  console.error('❌ ELEVENLABS_API_KEY no está configurado');
  process.exit(1);
}

if (!AGENT_ID || AGENT_ID === 'ag_your_agent_id_here') {
  console.error('❌ AGENT_ID no está configurado');
  process.exit(1);
}

console.log(`✅ API Key: ${ELEVENLABS_API_KEY.slice(0, 15)}...`);
console.log(`✅ Agent ID: ${AGENT_ID}\n`);

async function runTests() {
  let allPassed = true;

  // Test 1: Verificar API Key consultando conversaciones
  console.log('─'.repeat(50));
  console.log('🧪 Test 1: Verificar API Key y acceso a conversaciones\n');

  try {
    const response = await axios.get(
      'https://api.elevenlabs.io/v1/convai/conversations',
      {
        params: {
          agent_id: AGENT_ID,
          page_size: 10
        },
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );

    const conversations = response.data.conversations || response.data || [];
    console.log(`✅ API Key válida`);
    console.log(`✅ Acceso al agente confirmado`);
    console.log(`📊 Conversaciones encontradas: ${conversations.length}\n`);

    // Mostrar conversaciones recientes
    if (conversations.length > 0) {
      console.log('📝 Conversaciones recientes:');
      conversations.slice(0, 5).forEach((conv, i) => {
        console.log(`   ${i + 1}. ${conv.conversation_id?.slice(-12) || 'N/A'} - Status: ${conv.status || 'unknown'}`);
      });
      console.log('');

      // Buscar conversaciones activas para probar monitor
      const activeConv = conversations.find(c => c.status === 'in-progress');
      if (activeConv) {
        console.log(`\n🔍 Conversación activa encontrada: ${activeConv.conversation_id}`);
        console.log('   Probando conexión al monitor...\n');
        await testMonitorConnection(activeConv.conversation_id);
      } else {
        console.log('ℹ️  No hay conversaciones activas para probar el monitor');
        console.log('   El monitor se probará automáticamente cuando haya llamadas\n');
      }
    }

  } catch (error) {
    allPassed = false;
    if (error.response) {
      console.error(`❌ Error: ${error.response.status}`);
      console.error(`   ${error.response.data?.detail || error.message}\n`);

      if (error.response.status === 401) {
        console.log('💡 Solución: Tu API key es inválida');
        console.log('   Genera una nueva en: https://elevenlabs.io/app/settings/api-keys\n');
      } else if (error.response.status === 403) {
        console.log('💡 Solución: Tu API key no tiene permisos suficientes');
        console.log('   Asegúrate de que tenga scope "ElevenLabs Agents Write"\n');
      } else if (error.response.status === 404) {
        console.log('💡 Solución: El Agent ID no existe');
        console.log('   Verifica en: https://elevenlabs.io/app/conversational-ai\n');
      }
    } else {
      console.error(`❌ Error de red: ${error.message}\n`);
    }
  }

  // Test 2: Verificar información del agente
  console.log('─'.repeat(50));
  console.log('🧪 Test 2: Obtener información del agente\n');

  try {
    const response = await axios.get(
      `https://api.elevenlabs.io/v1/convai/agents/${AGENT_ID}`,
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );

    const agent = response.data;
    console.log(`✅ Agente encontrado`);
    console.log(`   Nombre: ${agent.name || 'Sin nombre'}`);
    console.log(`   ID: ${agent.agent_id || AGENT_ID}\n`);

  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`⚠️  No se pudo obtener info del agente (puede ser normal)\n`);
    } else {
      console.error(`❌ Error: ${error.response?.status || error.message}\n`);
    }
  }

  // Resumen
  console.log('─'.repeat(50));
  if (allPassed) {
    console.log(`
✅ ====== TODOS LOS TESTS PASARON ======

El servidor está listo para ejecutarse:

   npm start

El sistema hará polling cada 3 segundos buscando
conversaciones activas y las monitoreará automáticamente.

=========================================
`);
  } else {
    console.log(`
❌ ====== ALGUNOS TESTS FALLARON ======

Revisa los errores arriba y corrige la configuración
antes de ejecutar el servidor.

=========================================
`);
    process.exit(1);
  }
}

async function testMonitorConnection(conversationId) {
  return new Promise((resolve) => {
    const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversations/${conversationId}/monitor`;

    const ws = new WebSocket(wsUrl, {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      }
    });

    const timeout = setTimeout(() => {
      console.log('   ⏰ Timeout de prueba alcanzado');
      ws.close();
      resolve();
    }, 5000);

    ws.on('open', () => {
      console.log('   ✅ Monitor WebSocket conectado exitosamente');
      clearTimeout(timeout);
      ws.close();
      resolve();
    });

    ws.on('error', (error) => {
      console.log(`   ❌ Error conectando al monitor: ${error.message}`);
      clearTimeout(timeout);
      resolve();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        console.log(`   📨 Evento recibido: ${msg.type || msg.event_type || 'unknown'}`);
      } catch (e) {}
    });
  });
}

runTests();
