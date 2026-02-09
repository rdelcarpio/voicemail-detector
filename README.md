# Voicemail Detector para ElevenLabs Conversational AI

Sistema de detección automática de voicemail que se conecta vía WebSocket a ElevenLabs y termina llamadas automáticamente cuando detecta buzones de voz o música de espera.

## Problema que Resuelve

Las empresas de cobranza y call centers que usan agentes de voz de ElevenLabs enfrentan un problema costoso: aproximadamente 40% de las llamadas van a voicemail y se quedan consumiendo minutos innecesariamente.

**Ejemplo de impacto:**
- 10,000 llamadas/día
- 40% van a voicemail (4,000 llamadas)
- 5 minutos promedio por voicemail
- Costo: $0.08/minuto
- **Desperdicio mensual: $48,000**

Este sistema detecta voicemails en segundos y termina las llamadas automáticamente, reduciendo costos drásticamente.

## Cómo Funciona

El sistema usa tres métodos de detección:

### Método 1: Palabras Clave (90% de casos)
Detecta frases típicas de voicemail en las transcripciones:
- "buzón de voz", "deje su mensaje"
- "después del tono", "no puedo contestar"
- "voicemail", "leave a message"

### Método 2: Audio Continuo (10% de casos)
Detecta música de espera o audio continuo sin transcripción humana después de que el agente habla.

### Método 3: Timeout sin Respuesta
Si el agente habla y no hay respuesta humana en 20 segundos, termina la llamada y marca para revisión.

## Requisitos Previos

- Node.js 18.0.0 o superior
- Cuenta de ElevenLabs con acceso a Conversational AI
- API Key de ElevenLabs
- Agent ID de tu agente conversacional

## Instalación

### 1. Clonar o descargar el proyecto

```bash
cd voicemail-detector
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Edita el archivo `.env` con tus credenciales:

```env
ELEVENLABS_API_KEY=sk_tu_api_key_aqui
AGENT_ID=ag_tu_agent_id_aqui
```

**Dónde encontrar las credenciales:**
- API Key: https://elevenlabs.io/app/settings/api-keys
- Agent ID: https://elevenlabs.io/app/conversational-ai (selecciona tu agente)

### 4. Probar la conexión

```bash
npm test
```

Esto verificará que tus credenciales son válidas y que puedes conectarte al WebSocket.

### 5. Iniciar el servidor

```bash
npm start
```

O en modo desarrollo (con auto-reload):

```bash
npm run dev
```

## Deploy en Railway

### 1. Crear cuenta en Railway
Visita https://railway.app y crea una cuenta.

### 2. Crear nuevo proyecto
- Click en "New Project"
- Selecciona "Deploy from GitHub repo" o "Empty Project"

### 3. Configurar variables de entorno
En el dashboard de Railway, ve a "Variables" y agrega:
- `ELEVENLABS_API_KEY`: Tu API key
- `AGENT_ID`: Tu Agent ID

### 4. Deploy
Si conectaste GitHub, Railway hará deploy automático.
Si no, puedes usar Railway CLI:

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

### 5. Verificar
En el dashboard de Railway, ve a "Deployments" y revisa los logs para confirmar que está funcionando.

## Actualizar Frases de Voicemail

Puedes actualizar las frases sin reiniciar el servidor:

1. Edita `voicemail_phrases.json`
2. Agrega nuevas frases al array `phrases`
3. El servidor recargará automáticamente las frases cada hora

Para recarga inmediata, reinicia el servidor.

**Formato del archivo:**
```json
{
  "description": "Frases de detección de voicemail",
  "lastUpdated": "2024-01-15",
  "phrases": [
    "buzón de voz",
    "deje su mensaje",
    "nueva frase aquí"
  ]
}
```

## Estructura del Proyecto

```
voicemail-detector/
├── server.js              # Servidor principal
├── test-connection.js     # Script de prueba de conexión
├── voicemail_phrases.json # Frases de voicemail
├── package.json           # Dependencias y scripts
├── .env                   # Variables de entorno (no commitear)
├── .gitignore            # Archivos ignorados por git
├── Procfile              # Configuración para Railway
├── railway.json          # Configuración adicional de Railway
└── README.md             # Esta documentación
```

## Monitoreo de Logs

### Logs en consola

El servidor muestra logs en tiempo real con emojis para facilitar el monitoreo:

```
🎤 [abc12345] Usuario: "hola buenos días"
✅ [abc12345] Respuesta humana detectada

🚨 ====== VOICEMAIL DETECTADO ======
📞 Conversación: conv_xyz789
🔍 Frase detectada: "buzón de voz"
📝 Transcripción: "ha llamado al buzón de voz de..."
====================================
```

### Archivos de log

Cada hora se guarda un archivo JSON con las detecciones:
- Formato: `voicemail_log_1234567890.json`
- Contiene: todas las detecciones con transcripciones completas
- Útil para: análisis y mejora del sistema

### Revisar detecciones pendientes

Busca logs con `needsReview: true` para encontrar posibles nuevas frases de voicemail que deberías agregar.

## Troubleshooting

### Error: "ELEVENLABS_API_KEY no está configurado"
- Verifica que el archivo `.env` existe
- Asegúrate de que la API key no tiene espacios extra
- Confirma que la API key comienza con `sk_`

### Error: "401 Unauthorized"
- Tu API key es inválida o ha expirado
- Genera una nueva en https://elevenlabs.io/app/settings/api-keys

### Error: "404 Not Found"
- El Agent ID no existe o es incorrecto
- Verifica el ID en https://elevenlabs.io/app/conversational-ai

### WebSocket se desconecta frecuentemente
- Verifica tu conexión a internet
- El servidor reconecta automáticamente con exponential backoff
- Máximo 10 intentos de reconexión

### No detecta algunos voicemails
1. Revisa los logs con `needsReview: true`
2. Agrega las frases faltantes a `voicemail_phrases.json`
3. El sistema aprende con cada actualización

### Memoria alta
- El sistema limpia conversaciones terminadas automáticamente
- Los logs se guardan cada hora y se limpia el array en memoria
- Si persiste, reinicia el servidor

## ROI y Ahorro Esperado

### Cálculo de ejemplo

**Situación actual:**
- 10,000 llamadas/día
- 40% voicemail = 4,000 llamadas
- 5 min promedio en voicemail = 20,000 minutos/día
- $0.08/minuto = $1,600/día = **$48,000/mes**

**Con Voicemail Detector:**
- Detección en ~5-10 segundos promedio
- 4,000 × 0.15 min = 600 minutos/día
- $0.08/minuto = $48/día = **$1,440/mes**

**Ahorro mensual: $46,560 (97%)**

### Métricas de efectividad

- **Método 1 (keywords):** ~90% de detecciones, 2-5 segundos
- **Método 2 (audio):** ~8% de detecciones, 25 segundos
- **Método 3 (timeout):** ~2% de detecciones, 20 segundos

## Soporte

Para reportar problemas o sugerir mejoras, abre un issue en el repositorio.

## Licencia

MIT
