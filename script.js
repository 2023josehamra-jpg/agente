// Referencias a los elementos del DOM
const zonaDeChat = document.getElementById('zona-de-chat');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const chatForm = document.getElementById('chat-form');

// Variables de estado
let isWaitingResponse = false;
const TIMEOUT_MS = 10000; // Tiempo límite de solicitud: 10 segundos
const COOLDOWN_MS = 2000;  // Tiempo de espera obligatorio entre envíos

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

// Enviar el mensaje e interactuar con el Webhook
async function enviarMensaje(event) {
  event.preventDefault();

  const mensajeTexto = userInput.value.trim();
  if (!mensajeTexto || isWaitingResponse) return;

  // Bloqueo de UI
  isWaitingResponse = true;
  sendBtn.disabled = true;
  userInput.disabled = true;

  // Renderizar mensaje del usuario
  agregarMensaje(mensajeTexto, 'user');
  userInput.value = '';
  userInput.style.height = 'auto';

  mostrarCargando();

  // Control de tiempo límite con AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: mensajeTexto }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Error en el servidor: ${response.status}`);
    }

    const data = await response.json();
    removerCargando();

    // Obtener y mostrar la respuesta del agente
    const respuestaAgente = data.reply || data.message || "Solicitud procesada con éxito.";
    agregarMensaje(respuestaAgente, 'agent');

  } catch (error) {
    clearTimeout(timeoutId);
    removerCargando();

    if (error.name === 'AbortError') {
      agregarMensaje("La consulta superó el tiempo límite de espera. Por favor, reintenta.", 'error');
    } else {
      // Respuesta de contingencia si el webhook de prueba no está activo
      agregarMensaje("Simulación de respuesta: Para realizar este trámite, diríjase a la sección de trámites en línea o presente su DNI y credencial en la sede más cercana.", 'agent');
    }
  } finally {
    // Temporizador de espera (cooldown)
    setTimeout(() => {
      isWaitingResponse = false;
      sendBtn.disabled = false;
      userInput.disabled = false;
      userInput.focus();
    }, COOLDOWN_MS);
  }
}
