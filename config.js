const CONFIG = {
  titulo: "Feliz cumpleaños amor",
  frase: "Te Amo",
  textoBoton: "¿Agarramos ruta?",

  textoEncabezado: "Nuestra aventura 🚗💨",
  textoIntroMapa: "Durante la travesía te voy dejando pistas y vos vas guardando recuerdos. Después de la última parada seguimos igual, con un alto cada tanto. ¡Disfrutá cada kilómetro! 🎁",
  textoBuscando: "Buscando tu ubicación…",
  textoSinGps: "No puedo ver tu ubicación. Activá el permiso de localización en el navegador.",
  textoReintentar: "Reintentar",

  textoSubirFoto: "Subir recuerdo 📸",
  textoSeguir: "Seguir",
  textoTerminar: "Terminar recorrido 🏁",
  textoReiniciar: "Empezar de nuevo 🔄",
  textoFinal: "Así quedó nuestro recorrido 💞",
  textoConfirmar: "¿Empezar de nuevo?",
  textoConfirmReiniciar: "Se borra el recorrido que está en curso y sus recuerdos. Los recorridos ya terminados se conservan.",
  textoSi: "Sí, dale",
  textoNo: "Ahora no",
  textoBorrarSi: "Sí, borrar",
  textoTituloBorrar: "¿Borrar este recorrido?",
  textoBorrar: "🗑",
  textoConfirmBorrar: "Se borra el recorrido del {detalle} y todos sus recuerdos. No se puede deshacer.",
  textoRecorridos: "Recorridos guardados ({n})",
  textoRecorrido: "Recorrido del {fecha} · {km} km",
  textoHistorial: "Recorridos guardados",
  textoSinRecorridos: "Todavía no hay recorridos terminados.",
  textoVolver: "Volver",

  textoWakeOn: "Pantalla encendida 🔆",
  textoWakeOff: "Mantener pantalla encendida 💤",

  /* Servicios públicos de OSRM para calcular los tramos que el GPS no registró.
     Se prueban en orden y el primero que responde gana. El segundo solo entra si
     el primero falla, porque el servicio público pide no pasar de 1 pedido/seg. */
  osrm: [
    "https://router.project-osrm.org/route/v1/driving",
    "https://routing.openstreetmap.de/routed-car/route/v1/driving"
  ],

  hitos: [
    { km: 30, titulo: "¿Dónde pensas que vamos?", mensaje: "Vamos a ir a un lugar solo para hacer un poco de tiempo. Hacemos mates?", foto: true, input: true, placeholder: "Escribí tu respuesta…" },
    { km: 100, titulo: "Estamos cerca", mensaje: "Es uno de tus lugares favoritos, donde podés gastar mucha platita.", foto: true, input: true, placeholder: "Escribí tu respuesta…" },
    { km: 145, titulo: "Un lugar sin reloj", mensaje: "No hay paredes, ni reloj, solo un techo de tela, el fuego y vos. 🌌", foto: true, input: true, placeholder: "Escribí tu respuesta…" },
    { km: 190, titulo: "Paramos a comer", mensaje: "La última parada antes de volver a Baradero: paramos a comer en un lugar con más nombre propio que el lugar mismo. 🍽 Antes de elegirlo, decime: ¿qué se nos viene después?", foto: true, input: true, placeholder: "Escribí tu respuesta…" }
  ],

  /* Cada cuántos kilómetros, una vez pasada la última parada de la lista de
     arriba, aparece un alto para guardar un recuerdo. No hay destinos ni pistas
     ahí: es solo un lugar donde frenar a sacar una foto y escribir algo, para
     que el viaje siga teniendo motivos de sacar el celular aunque ya se haya
     terminado la ruta. El recorrido no se termina solo nunca: lo cierra ella
     cuando quiera, en cualquier momento. */
  kmRecuerdo: 20,
  tituloRecuerdo: "Un alto en el camino",
  mensajeRecuerdo: "Ya llegamos a la última parada, pero la ruta sigue. Guardá un recuerdo de acá 📸",
  selloRecuerdo: "📸 RECUERDO",
  placeholderRecuerdo: "Escribí algo de este lugar…",

  /* Cada parada se identifica por su km, nunca por su posición, así que se
     pueden agregar, correr o borrar en cualquier momento sin romper el
     progreso ya guardado. El recorrido tampoco se termina solo: el botón para
     terminarlo está disponible siempre. */
  destinos: [
    { km: 135, titulo: "¡Llegamos!", mensaje: "Tu regalo es elegirte solo una cosa del shopping, pensalo muy bien.", foto: true },
    { km: 177, titulo: "El mejor destino", mensaje: "Llegamos. Esta vez no vas a dormir entre cuatro paredes. Prepara las ganas de desconectar, y solo disfuta.", foto: true },
    { km: 219, titulo: "¡Llegamos a Luján!", mensaje: "Luján, la ciudad del río y del Santuario. Guardamos el auto y caminamos, que de acá en adelante mandás vos. 💐 Y si seguimos viaje, cada 20 km te freno para guardar un recuerdo más.", foto: true }
  ]
};