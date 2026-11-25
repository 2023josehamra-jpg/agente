// Referencias a los elementos del DOM
const zonaDeChat = document.getElementById('zona-de-chat');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');

// Variables de estado y sesión
let sessionIdMemoria = null;
let isWaitingResponse = false;
const TIMEOUT_MS = 30000; // 30 segundos para que Make y la IA respondan
const COOLDOWN_MS = 1500; // Pausa mínima entre envíos

// Inicializar sessionId único para mantener el historial en Data Store
const sessionId = obtenerOCrearSessionId();

// Genera o recupera un sessionId único
function obtenerOCrearSessionId() {
  const claveStorage = 'consultor_medico_session_id';
  try {
    const guardado = localStorage.getItem(claveStorage);
    if (guardado) return guardado;
  } catch (e) {}

  const nuevoId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `ses-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (e) {
    sessionIdMemoria = nuevoId;
  }

  return nuevoId;
}

// Auto-ajuste de altura para el campo de texto
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
});

// Permitir envío con la tecla Enter (sin Shift)
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// Función para insertar sugerencias rápidas
function usarSugerencia(texto) {
  if (isWaitingResponse) return;
  userInput.value = texto;
  userInput.focus();
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
}

// Formatear la hora actual
function obtenerHoraActual() {
  const ahora = new Date();
  return ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Agregar mensaje visual al área de chat
function agregarMensaje(texto, tipo = 'user') {
  const mensajeDiv = document.createElement('div');
  mensajeDiv.classList.add('message', tipo);

  const contenidoDiv = document.createElement('div');
  contenidoDiv.classList.add('message-content');
  contenidoDiv.textContent = texto;

  const horaSpan = document.createElement('span');
  horaSpan.classList.add('message-time');
  horaSpan.textContent = obtenerHoraActual();

  mensajeDiv.appendChild(contenidoDiv);
  mensajeDiv.appendChild(horaSpan);

  zonaDeChat.appendChild(mensajeDiv);
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

// Mostrar o quitar indicador de "cargando"
function mostrarCargando() {
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-indicator';
  loadingDiv.classList.add('message', 'agent');
  loadingDiv.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  zonaDeChat.appendChild(loadingDiv);
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

function removerCargando() {
  const loadingDiv = document.getElementById('loading-indicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

// Procesa la respuesta de Make de forma segura (JSON o texto plano)
function procesarRespuestaMake(textoCrudo) {
  let texto = textoCrudo.trim();
  if (!texto) return 'Solicitud procesada con éxito.';

  texto = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const data = JSON.parse(texto);
    if (data && typeof data === 'object') {
      return data.respuesta || data.response || data.reply || data.message || data.mensaje || texto;
    }
  } catch (e) {
    if (texto.startsWith('{') && texto.endsWith('}')) {
      try {
        const dataReparada = JSON.parse(texto.replace(/\r?\n/g, '\\n'));
        return dataReparada.respuesta || dataReparada.response || dataReparada.reply || dataReparada.message || dataReparada.mensaje || texto;
      } catch (e2) {}
    }
  }

  return texto;
}

// Enviar el mensaje e interactuar con el Webhook
async function enviarMensaje(event) {
  event.preventDefault();

  const mensajeTexto = userInput.value.trim();
  if (!mensajeTexto || isWaitingResponse) return;

  if (typeof WEBHOOK_URL === 'undefined' || !WEBHOOK_URL.trim()) {
    agregarMensaje('Falta configurar la URL del webhook en config.js.', 'error');
    return;
  }

  // Bloqueo de UI
  isWaitingResponse = true;
  sendBtn.disabled = true;
  userInput.disabled = true;

  // Renderizar mensaje del usuario
  agregarMensaje(mensajeTexto, 'user');
  userInput.value = '';
  userInput.style.height = 'auto';

  mostrarCargando();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: sessionId,
        mensaje: mensajeTexto,
        fecha: new Date().toISOString()
      }),
      signal: controller.signal
    });

    const textoCrudo = await response.text();
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }

    removerCargando();
    const respuestaAgente = procesarRespuestaMake(textoCrudo);
    agregarMensaje(respuestaAgente, 'agent');

  } catch (error) {
    clearTimeout(timeoutId);
    removerCargando();

    if (error.name === 'AbortError') {
      agregarMensaje('La consulta superó el tiempo límite de espera. Por favor, reintentá.', 'error');
    } else {
      agregarMensaje('No se pudo conectar con el servidor. Revisá que el escenario en Make esté en Active.', 'error');
    }
  } finally {
    setTimeout(() => {
      isWaitingResponse = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }, COOLDOWN_MS);
  }
}
