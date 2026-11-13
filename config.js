// Referencias a los elementos del DOM
const zonaDeChat = document.getElementById('zona-de-chat');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');

// Constantes de configuración
const TIMEOUT_MS = 30000; // 30 segundos máximo de espera
const COOLDOWN_MS = 1500; // Pausa mínima de 1,5 segundos entre envíos
const MAX_CARACTERES = 500;

// Variables de estado y sesión
let isWaitingResponse = false;
let memoriaSessionId = null;

// Generar u obtener el identificador único de sesión
function obtenerSessionId() {
  const claveStorage = 'promptin_session_id';
  try {
    const guardado = localStorage.getItem(claveStorage);
    if (guardado) return guardado;
  } catch (e) {
    // Si localStorage está bloqueado, seguimos con memoria
  }

  if (memoriaSessionId) return memoriaSessionId;

  const nuevoId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `sesion-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;

  memoriaSessionId = nuevoId;

  try {
    localStorage.setItem(claveStorage, nuevoId);
  } catch (e) {
    // Ignorar error si no se puede escribir en localStorage
  }

  return nuevoId;
}

const sessionId = obtenerSessionId();

// Validar si la URL del webhook está configurada
function webhookConfigurado() {
  if (typeof WEBHOOK_URL !== 'string') return false;
  const url = WEBHOOK_URL.trim();
  if (!url || url.includes('ACA VA') || url.includes('ejemplo-webhook-prueba')) {
    return false;
  }
  return true;
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
  userInput.value = texto.slice(0, MAX_CARACTERES);
  userInput.focus();
  userInput.style.height = 'auto';
  userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
}

// Formatear la hora actual
function obtenerHoraActual() {
  const ahora = new Date();
  return ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Agregar mensaje visual al área de chat usando textContent
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

// Mostrar indicador de "cargando" sin innerHTML
function mostrarCargando() {
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'loading-indicator';
  loadingDiv.classList.add('message', 'agent');

  const typingContainer = document.createElement('div');
  typingContainer.classList.add('typing-indicator');

  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('div');
    dot.classList.add('typing-dot');
    typingContainer.appendChild(dot);
  }

  loadingDiv.appendChild(typingContainer);
  zonaDeChat.appendChild(loadingDiv);
  zonaDeChat.scrollTop = zonaDeChat.scrollHeight;
}

// Quitar indicador de "cargando"
function removerCargando() {
  const loadingDiv = document.getElementById('loading-indicator');
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

// Extraer texto válido de un objeto respuesta
function extraerCampoTexto(obj) {
  const claves = ['response', 'respuesta', 'message', 'mensaje'];
  for (const clave of claves) {
    if (typeof obj[clave] === 'string' && obj[clave].trim() !== '') {
      return obj[clave];
    }
  }
  return null;
}

// Analizar el texto crudo recibido de Make de forma tolerante
function procesarRespuestaMake(textoCrudo) {
  const limpio = textoCrudo.trim();
  if (!limpio) return '(respuesta vacía)';

  // Quitar envoltorios Markdown como ```json ... ```
  const sinMarkdown = limpio
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Primer intento: JSON válido estándar
  try {
    const parsed = JSON.parse(sinMarkdown);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const textoExtraido = extraerCampoTexto(parsed);
      return textoExtraido !== null ? textoExtraido : 'Make respondió, pero sin el campo response';
    }
    // Si es número, booleano, null, array o string JSON, devolver texto original
    return limpio;
  } catch (e) {
    // Si parece un objeto JSON roto por saltos de línea crudos
    if (sinMarkdown.startsWith('{') && sinMarkdown.endsWith('}')) {
      try {
        const reparado = sinMarkdown.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (match) =>
          match.replace(/\r?\n/g, '\\n')
        );
        const parsedReparado = JSON.parse(reparado);
        if (parsedReparado && typeof parsedReparado === 'object' && !Array.isArray(parsedReparado)) {
          const textoExtraido = extraerCampoTexto(parsedReparado);
          return textoExtraido !== null ? textoExtraido : 'Make respondió, pero sin el campo response';
        }
      } catch (e2) {
        // Respaldo con expresión regular para extraer el campo si las comillas también venían sin escapar
        const claves = ['response', 'respuesta', 'message', 'mensaje'];
        for (const clave of claves) {
          const regex = new RegExp(`"${clave}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?:,|\\})`, 'i');
          const match = sinMarkdown.match(regex);
          if (match && match[1].trim() !== '') {
            return match[1].replace(/\\n/g, '\n');
          }
        }
        return 'Make respondió, pero sin el campo response';
      }
    }

    // Texto plano real (ej: "Accepted")
    return limpio;
  }
}

// Enviar el mensaje e interactuar con el Webhook
async function enviarMensaje(event) {
  event.preventDefault();

  if (!webhookConfigurado()) {
    agregarMensaje('Falta pegar la URL de tu webhook en config.js', 'error');
    return;
  }

  const mensaje = userInput.value.trim();
  if (!mensaje || isWaitingResponse) return;

  if (mensaje.length > MAX_CARACTERES) {
    agregarMensaje(`El mensaje no puede superar los ${MAX_CARACTERES} caracteres.`, 'error');
    return;
  }

  // Bloqueo de interfaz
  isWaitingResponse = true;
  sendBtn.disabled = true;
  userInput.disabled = true;

  agregarMensaje(mensaje, 'user');
  userInput.value = '';
  userInput.style.height = 'auto';

  mostrarCargando();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const respuesta = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        mensaje,
        fecha: new Date().toISOString()
      }),
      signal: controller.signal
    });

    const textoRespuesta = await respuesta.text();
    removerCargando();

    if (!respuesta.ok) {
      agregarMensaje(
        `Make respondió con error (código ${respuesta.status}). Revisá que tu escenario esté en Active o que hayas apretado Run once.`,
        'error'
      );
      return;
    }

    const textoFinal = procesarRespuestaMake(textoRespuesta);
    agregarMensaje(textoFinal, 'agent');

  } catch (error) {
    removerCargando();

    if (error.name === 'AbortError') {
      agregarMensaje('Se agotó el tiempo de espera (30 segundos). Intentá de nuevo.', 'error');
    } else {
      agregarMensaje('Error de red al conectar con Make. Verificá tu conexión a internet.', 'error');
    }
  } finally {
    clearTimeout(timeoutId);
    removerCargando();

    // Pausa mínima de 1,5 segundos antes de rehabilitar el envío
    setTimeout(() => {
      isWaitingResponse = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }, COOLDOWN_MS);
  }
}
