const CONFIG = {
  titulo: "Feliz cumpleaños amor",
  frase: "Te Amo",
  textoBoton: "¿Agarramos ruta?",

  textoEncabezado: "Nuestra aventura 🚗💨",
  textoIntroMapa: "Durante la travesía te voy dejando pistas y vos vas guardando recuerdos. ¡Disfrutá cada kilómetro! 🎁",
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
    { km: 145, titulo: "Un lugar sin reloj", mensaje: "No hay paredes, ni reloj, solo un techo de tela, el fuego y vos. 🌌", foto: true, input: true, placeholder: "Escribí tu respuesta…" }
  ],

  destinos: [
    { km: 125, titulo: "¡Llegamos!", mensaje: "Tu regalo es elegirte solo una cosa del shopping, pensalo muy bien.", foto: true },
    { km: 187, titulo: "El mejor destino", mensaje: "Llegamos. Esta vez no vas a dormir entre cuatro paredes. Prepara las ganas de desconectar, y solo disfuta.", foto: true }
    /* TODO: falta la parada que sigue después del glamping. Decime km, si es pista
       o destino, título y mensaje, y la agregás acá. El recorrido no se termina solo:
       cuando ya vio todas las paradas le aparece el botón para terminarlo. */
  ]
};