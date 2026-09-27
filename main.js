(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var LS_CLAVE = "cumpleAventura_v3";
  var CFG = (typeof CONFIG !== "undefined") ? CONFIG : null;

  if (!CFG) { console.error("config.js no cargó"); return; }

  /* ======================== ESTADO ======================== */
  function estadoInicial() {
    return {
      iniciado: false, pos: null, track: [], km: 0, saltos: [],
      vistas: [], hitoFotos: [], destinosVistos: [], destinoFotos: [], respuestas: [],
      pendientes: [], finalizado: false
    };
  }

  var ARRAYS = ["track", "saltos", "vistas", "hitoFotos", "destinosVistos", "destinoFotos", "respuestas", "pendientes"];

  function cargar() {
    var base = estadoInicial();
    try {
      var guardado = JSON.parse(localStorage.getItem(LS_CLAVE));
      if (guardado && typeof guardado === "object") {
        Object.keys(base).forEach(function (k) {
          if (guardado[k] !== undefined) base[k] = guardado[k];
        });
      }
    } catch (e) { return estadoInicial(); }
    ARRAYS.forEach(function (k) {
      if (!Array.isArray(base[k])) base[k] = [];
    });
    if (!base.pos || typeof base.pos.lat !== "number" || typeof base.pos.lon !== "number") base.pos = null;
    if (typeof base.km !== "number" || !isFinite(base.km) || base.km < 0) base.km = 0;
    return base;
  }

  /* El track se dibuja como tramos separados: un "salto" (pausa larga o teletransporte
     del GPS) suma kilómetros pero NO dibuja una recta falsa entre dos puntos lejanos. */
  function tramosTrack() {
    var tramos = [];
    var ini = 0;
    estado.saltos.forEach(function (i) {
      if (i > ini && i < estado.track.length) {
        tramos.push(estado.track.slice(ini, i));
        ini = i;
      }
    });
    if (ini < estado.track.length) tramos.push(estado.track.slice(ini));
    return tramos;
  }

  function guardar() {
    try { localStorage.setItem(LS_CLAVE, JSON.stringify(estado)); }
    catch (e) { console.warn("No se pudo guardar el progreso:", e); }
  }

  var estado = cargar();

  /* ======================== UTILIDADES ======================== */
  function formatearKm(metros) {
    return (metros / 1000).toFixed(1).replace(".", ",");
  }

  function haversine(a, b) {
    var R = 6371000;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLon = (b.lon - a.lon) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180;
    var la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ======================== PANTALLAS ======================== */
  function mostrarPantalla(id) {
    ["pantalla-portada", "pantalla-viaje", "pantalla-final"].forEach(function (t) {
      var el = $("#" + t);
      if (el) el.classList.toggle("oculto", t !== id);
    });
  }

  function aplicarTextos() {
    $(".titulo").textContent = CFG.titulo;
    $(".frase").textContent = CFG.frase;
    $("#btn-empezar").textContent = CFG.textoBoton;
    $("#v-encabezado").textContent = CFG.textoEncabezado;
    $("#v-intro").textContent = CFG.textoIntroMapa;
    $("#v-buscando").textContent = CFG.textoBuscando;
    $("#btn-reintentar").textContent = CFG.textoReintentar;
    $("#m-subir-foto").textContent = CFG.textoSubirFoto;
    $("#m-cerrar").textContent = CFG.textoSeguir;
    $("#btn-terminar").textContent = CFG.textoTerminar;
    $("#f-mensaje").textContent = CFG.textoFinal;
    $("#btn-reiniciar").textContent = CFG.textoReiniciar;
  }

  /* ======================== INDEXEDDB (fotos) ======================== */
  var DB = null;

  function abrirDb(cb) {
    if (DB) { cb(); return; }
    var req = indexedDB.open("cumple_aventura", 1);
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains("fotos")) {
        req.result.createObjectStore("fotos", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = function () { DB = req.result; cb(); };
    req.onerror = function () { console.error("IndexedDB no disponible"); };
  }

  function guardarFoto(foto, cb) {
    abrirDb(function () {
      var tx = DB.transaction("fotos", "readwrite");
      tx.objectStore("fotos").add(foto);
      tx.oncomplete = function () { if (cb) cb(); };
    });
  }

  function todasFotos(cb) {
    abrirDb(function () {
      var tx = DB.transaction("fotos", "readonly");
      var r = tx.objectStore("fotos").getAll();
      r.onsuccess = function () { cb(r.result || []); };
    });
  }

  function limpiarFotos(cb) {
    abrirDb(function () {
      var tx = DB.transaction("fotos", "readwrite");
      tx.objectStore("fotos").clear();
      tx.oncomplete = function () { if (cb) cb(); };
    });
  }

  /* ======================== MAPA (Leaflet) ======================== */
  var mapaObj = null;
  var capaDinamica = null;
  var siguiendo = true;

  function dibujarMapa() {
    if (!window.L || !estado.pos) return;
    if (estado.finalizado) return;

    $("#v-buscando").classList.add("oculto");
    var wrap = $("#mapa-wrap");
    wrap.classList.remove("oculto");

    if (!mapaObj) {
      mapaObj = window.L.map("mapa").setView([estado.pos.lat, estado.pos.lon], 13);
      window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "&copy; Esri"
      }).addTo(mapaObj);
      mapaObj.on("dragstart zoomstart", function () { siguiendo = false; });
    }
    if (capaDinamica) mapaObj.removeLayer(capaDinamica);
    capaDinamica = window.L.layerGroup();

    tramosTrack().forEach(function (tramo) {
      if (tramo.length > 1) {
        var pts = tramo.map(function (p) { return [p.lat, p.lon]; });
        window.L.polyline(pts, { color: "#a9c3a0", weight: 5, opacity: 0.9 }).addTo(capaDinamica);
      }
    });
    window.L.circleMarker([estado.pos.lat, estado.pos.lon],
      { radius: 9, color: "#ffffff", fillColor: "#d65296", fillOpacity: 1, weight: 3 }).addTo(capaDinamica);

    capaDinamica.addTo(mapaObj);
    if (siguiendo) mapaObj.setView([estado.pos.lat, estado.pos.lon], mapaObj.getZoom() || 13);
    setTimeout(function () { if (mapaObj) mapaObj.invalidateSize(); }, 150);
  }

  var cargandoLeaflet = false;
  var alCargarLeaflet = [];

  function cargarLeaflet(cb) {
    cb = cb || dibujarMapa;
    if (window.L) { cb(); return; }
    alCargarLeaflet.push(cb);
    if (cargandoLeaflet) return;
    cargandoLeaflet = true;
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    var sc = document.createElement("script");
    sc.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    sc.onload = function () {
      var pendientes = alCargarLeaflet;
      alCargarLeaflet = [];
      cargandoLeaflet = false;
      pendientes.forEach(function (f) { f(); });
    };
    document.body.appendChild(sc);
  }

  /* ======================== GPS ======================== */
  var watcher = null;
  var ultimoProceso = 0;
  var ocultoEn = 0;
  var PAUSA_LARGA = 15000;
  var SALTO_METROS = 2000;

  function iniciarGps() {
    if (watcher !== null) return;
    if (!navigator.geolocation) { mostrarErrorGps(CFG.textoSinGps); return; }
    watcher = navigator.geolocation.watchPosition(
      function (pos) {
        ocultarErrorGps();
        var p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (!estado.pos) {
          estado.pos = p; guardar(); dibujarMapa(); return;
        }
        var ahora = Date.now();
        if (ahora - ultimoProceso < 4000) return;
        ultimoProceso = ahora;
        var d = haversine(estado.pos, p);
        if (d < 15) return;
        /* Si la app estuvo en segundo plano o el GPS se teletransportó, el tramo
           recta no se dibuja: los kilómetros sí se suman, pero sin mentir en el mapa. */
        var salto = (ocultoEn > 0 && ahora - ocultoEn > PAUSA_LARGA) || d > SALTO_METROS;
        ocultoEn = 0;
        agregarTramo(estado.pos, p, d, salto);
      },
      function (err) {
        if (err && err.code === 1) mostrarErrorGps(textoPermisoUbicacion());
        else if (!err || err.code !== 3) mostrarErrorGps("Todavía no tengo señal. Sigo intentando…");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  function agregarTramo(desde, hasta, d, salto) {
    estado.pos = hasta;
    estado.km += d;
    estado.track.push(hasta);
    if (salto) estado.saltos.push(estado.track.length - 1);
    if (estado.track.length > 6000) {
      var sobra = estado.track.length - 6000;
      estado.track.splice(0, sobra);
      estado.saltos = estado.saltos.map(function (i) { return i - sobra; })
        .filter(function (i) { return i > 0; });
    }
    guardar();
    renderKm();
    dibujarMapa();
    revisarEventos();
  }

  function renderKm() {
    var el = $("#v-km");
    if (el) el.textContent = formatearKm(estado.km);
  }

  /* ======================== EVENTOS (pistas y destinos) ======================== */
  var modalAbierto = false;
  var contextoFoto = null;
  var eventoActual = null;

  function yaPendiente(tipo, idx) {
    return estado.pendientes.some(function (p) { return p.tipo === tipo && p.idx === idx; });
  }

  function encolar(tipo, idx) {
    if (yaPendiente(tipo, idx)) return false;
    estado.pendientes.push({ tipo: tipo, idx: idx });
    return true;
  }

  function marcarVisto(ev) {
    if (!ev) return;
    if (ev.tipo === "pista") {
      if (estado.vistas.indexOf(ev.idx) === -1) estado.vistas.push(ev.idx);
    } else if (estado.destinosVistos.indexOf(ev.idx) === -1) {
      estado.destinosVistos.push(ev.idx);
    }
  }

  function revisarEventos() {
    var algo = false;

    CFG.hitos.forEach(function (h, i) {
      if (estado.vistas.indexOf(i) === -1 && estado.km >= h.km * 1000) {
        if (encolar("pista", i)) algo = true;
      }
    });

    CFG.destinos.forEach(function (d, i) {
      if (estado.destinosVistos.indexOf(i) === -1 && estado.km >= d.km * 1000) {
        if (encolar("destino", i)) algo = true;
      }
    });

    if (algo) { guardar(); siguienteEvento(); }
    intentarFinal();
  }

  function intentarFinal() {
    if (estado.finalizado) return false;
    /* Con la app en segundo plano no se finaliza nada: se retoma al volver. */
    if (document.hidden) return false;
    var todosVistos = CFG.hitos.every(function (h) {
      return estado.vistas.indexOf(CFG.hitos.indexOf(h)) !== -1;
    });
    var destinosVistos = CFG.destinos.every(function (d) {
      return estado.destinosVistos.indexOf(CFG.destinos.indexOf(d)) !== -1;
    });
    var tieneFotoUltimo = CFG.destinos.length > 0 &&
      estado.destinoFotos.indexOf(CFG.destinos.length - 1) !== -1;
    if (todosVistos && destinosVistos && tieneFotoUltimo) {
      setTimeout(finalizar, 300);
      return true;
    }
    actualizarBotonTerminar();
    return false;
  }

  function siguienteEvento() {
    if (modalAbierto || estado.pendientes.length === 0) return;
    if (document.hidden) return;
    abrirEvento(estado.pendientes[0]);
  }

  function abrirEvento(ev) {
    var sello, titulo, mensaje, conFoto = false;
    if (ev.tipo === "pista") {
      var h = CFG.hitos[ev.idx];
      sello = "🎁 PISTA";
      titulo = h.titulo;
      mensaje = h.mensaje;
      conFoto = !!h.foto;
    } else {
      var d = CFG.destinos[ev.idx];
      sello = "🎉 DESTINO";
      titulo = d.titulo;
      mensaje = d.mensaje;
      conFoto = true;
    }

    modalAbierto = true;
    contextoFoto = ev;
    eventoActual = ev;
    $("#m-sello").textContent = sello;
    $("#m-sello").classList.toggle("oculto", ev.tipo === "destino");
    $("#m-titulo").textContent = titulo || "";
    $("#m-texto").textContent = mensaje || "";
    var btnFoto = $("#m-subir-foto");
    btnFoto.classList.toggle("oculto", !conFoto);
    var inp = $("#m-input");
    var conInput = ev.tipo === "pista" && !!CFG.hitos[ev.idx].input;
    inp.classList.toggle("oculto", !conInput);
    if (conInput) {
      inp.value = estado.respuestas[ev.idx] || "";
      inp.placeholder = CFG.hitos[ev.idx].placeholder || "";
    }
    $("#modal-evento").classList.add("abierto");
  }

  function cerrarEvento() {
    if (eventoActual && eventoActual.tipo === "pista" && !$("#m-input").classList.contains("oculto")) {
      var v = $("#m-input").value.trim();
      if (v && estado.respuestas[eventoActual.idx] !== v) {
        estado.respuestas[eventoActual.idx] = v;
        guardar();
      }
    }
    /* El evento recién se da por visto cuando se cierra: si la app se suspende
       con el modal abierto, sigue en la cola y reaparece al volver. */
    for (var i = estado.pendientes.length - 1; i >= 0; i--) {
      var p = estado.pendientes[i];
      if (eventoActual && p.tipo === eventoActual.tipo && p.idx === eventoActual.idx) {
        estado.pendientes.splice(i, 1);
      }
    }
    marcarVisto(eventoActual);
    modalAbierto = false;
    contextoFoto = null;
    eventoActual = null;
    $("#modal-evento").classList.remove("abierto");
    guardar();
    siguienteEvento();
  }

  function actualizarBotonTerminar() {
    var todosVistos = CFG.hitos.every(function (h) {
      return estado.vistas.indexOf(CFG.hitos.indexOf(h)) !== -1;
    });
    var destinosVistos = CFG.destinos.every(function (d) {
      return estado.destinosVistos.indexOf(CFG.destinos.indexOf(d)) !== -1;
    });
    $("#btn-terminar").classList.toggle("oculto", !(todosVistos && destinosVistos && !estado.finalizado));
  }

  /* ======================== FOTOS ======================== */
  function pedirFoto() {
    var input = $("#input-foto");
    input.value = "";
    input.click();
  }

  function procesarArchivo(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var max = 1000;
        var escala = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement("canvas");
        cv.width = Math.round(img.width * escala);
        cv.height = Math.round(img.height * escala);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        var dataUrl = cv.toDataURL("image/jpeg", 0.8);
        guardarFotoRegistrada(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function guardarFotoRegistrada(dataUrl) {
    var ev = contextoFoto;
    var km = estado.km;
    var pos = estado.pos;
    if (!pos && estado.track.length) pos = estado.track[estado.track.length - 1];

    var foto = {
      fecha: new Date().toISOString(),
      km: km,
      lat: pos ? pos.lat : null,
      lon: pos ? pos.lon : null,
      dataUrl: dataUrl
    };

    guardarFoto(foto, function () {
      if (ev && ev.tipo === "pista" && estado.hitoFotos.indexOf(ev.idx) === -1) estado.hitoFotos.push(ev.idx);
      if (ev && ev.tipo === "destino" && estado.destinoFotos.indexOf(ev.idx) === -1) estado.destinoFotos.push(ev.idx);
      guardar();

      var esUltimoDestino = ev && ev.tipo === "destino" &&
        ev.idx === CFG.destinos.length - 1 &&
        estado.destinoFotos.indexOf(ev.idx) !== -1;

      cerrarEvento();

      /* Si se tomó la foto del último destino pero la app quedó en segundo plano,
         no se finaliza ahora: se retoma sola al volver a abrir la app. */
      if (esUltimoDestino && !document.hidden) {
        setTimeout(finalizar, 300);
      } else {
        renderRecuerdos();
        if (!intentarFinal()) actualizarBotonTerminar();
      }
    });
  }

  function renderRecuerdos() {
    todasFotos(function (fotos) {
      var gal = $("#galeria");
      gal.innerHTML = "";
      fotos.forEach(function (f) {
        var img = document.createElement("img");
        img.src = f.dataUrl;
        img.alt = "Recuerdo " + formatearKm(f.km) + " km";
        img.addEventListener("click", function () { abrirLightbox(f.dataUrl); });
        gal.appendChild(img);
      });
    });
  }

  /* ======================== FINAL ======================== */
  var mapaFinal = null;
  var mapaFinalListo = false;

  function finalizar() {
    if (estado.finalizado) return;
    estado.finalizado = true;
    guardar();
    if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
    mostrarPantalla("pantalla-final");
    renderRecuerdos();
    dibujarMapaFinal();
  }

  function dibujarMapaFinal() {
    if (!window.L) { cargarLeaflet(dibujarMapaFinal); return; }
    if (mapaFinalListo) return;
    var wrap = $("#mapa-final-wrap");
    wrap.classList.remove("oculto");

    if (!mapaFinal) {
      mapaFinal = window.L.map("mapa-final").setView([-34.6, -58.4], 10);
      window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "&copy; Esri"
      }).addTo(mapaFinal);
    }

    var grupo = window.L.layerGroup().addTo(mapaFinal);

    tramosTrack().forEach(function (tramo) {
      if (tramo.length > 1) {
        var pts = tramo.map(function (p) { return [p.lat, p.lon]; });
        window.L.polyline(pts, { color: "#e8a0b4", weight: 5, opacity: 0.9 }).addTo(grupo);
      }
    });

    var bounds = [];
    estado.track.forEach(function (p) { bounds.push([p.lat, p.lon]); });
    if (estado.pos) bounds.push([estado.pos.lat, estado.pos.lon]);

    todasFotos(function (fotos) {
      fotos.forEach(function (f) {
        if (f.lat === null || f.lon === null) return;
        var ic = window.L.divIcon({
          className: "foto-ic",
          html: '<img src="' + f.dataUrl + '">',
          iconSize: [56, 56],
          iconAnchor: [28, 28]
        });
        var mk = window.L.marker([f.lat, f.lon], { icon: ic }).addTo(grupo);
        mk.on("click", function () { abrirLightbox(f.dataUrl); });
        bounds.push([f.lat, f.lon]);
      });

      if (bounds.length) {
        mapaFinal.fitBounds(bounds, { padding: [40, 40] });
      }
      setTimeout(function () { if (mapaFinal) mapaFinal.invalidateSize(); }, 150);
      mapaFinalListo = true;
    });
  }

  /* ======================== LIGHTBOX ======================== */
  function abrirLightbox(src) {
    $("#lightbox-img").src = src;
    $("#lightbox").classList.remove("oculto");
  }

  /* ======================== ERRORES GPS ======================== */
  function esIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function esAndroid() {
    return /Android/.test(navigator.userAgent);
  }

  function textoPermisoUbicacion() {
    if (esIOS()) {
      return "Activaste el permiso de ubicación en Safari: Ajustes → Privacidad y seguridad → Servicios de localización → Safari → “Mientras se usa”. Luego recargá la página y volvé a tocarlo.";
    }
    if (esAndroid()) {
      return "Activaste el permiso de ubicación en el navegador: candado 🔒 junto a la URL → Configuración del sitio → Ubicación → Permitir. Luego recargá la página.";
    }
    return CFG.textoSinGps;
  }

  function mostrarErrorGps(texto) {
    $("#t-aviso-gps").textContent = texto;
    $("#aviso-gps").classList.remove("oculto");
  }

  function ocultarErrorGps() {
    $("#aviso-gps").classList.add("oculto");
  }

  /* ======================== FLUJO ======================== */
  function empezar() {
    estado.iniciado = true;
    guardar();
    mostrarPantalla("pantalla-viaje");
    renderKm();
    cargarLeaflet();
    iniciarGps();
    renderRecuerdos();
  }

  function reiniciar() {
    if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
    estado = estadoInicial();
    guardar();
    try { localStorage.removeItem(LS_CLAVE); } catch (e) {}
    var recargado = false;
    function recargar() {
      if (recargado) return;
      recargado = true;
      location.reload();
    }
    limpiarFotos(recargar);
    setTimeout(recargar, 500);
  }

  /* Atajo de prueba: tocar 5 veces la intro abre el próximo evento */
  function probarEvento() {
    if (modalAbierto) return;
    var pendientePista = CFG.hitos.findIndex(function (h, i) { return estado.vistas.indexOf(i) === -1; });
    var pendienteDest = CFG.destinos.findIndex(function (d, i) { return estado.destinosVistos.indexOf(i) === -1; });

    var ev = (pendientePista !== -1)
      ? { tipo: "pista", idx: pendientePista }
      : (pendienteDest !== -1 ? { tipo: "destino", idx: pendienteDest } : null);

    if (ev) {
      abrirEvento(ev);
      actualizarBotonTerminar();
    }
  }

  /* Atajo de prueba: tocar 5 veces el contador de km suma +30 km */
  function sumarKmPrueba() {
    estado.km += 30000;
    guardar();
    renderKm();
    revisarEventos();
    $("#modo-prueba").classList.remove("oculto");
  }

  function bindear() {
    $("#btn-empezar").addEventListener("click", empezar);

    $("#btn-reintentar").addEventListener("click", function () {
      if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
      ocultarErrorGps();
      iniciarGps();
    });

    $("#m-subir-foto").addEventListener("click", pedirFoto);
    $("#m-cerrar").addEventListener("click", cerrarEvento);
    $("#input-foto").addEventListener("change", function () {
      procesarArchivo(this.files && this.files[0]);
    });

    $("#btn-terminar").addEventListener("click", finalizar);
    $("#btn-reiniciar").addEventListener("click", reiniciar);

    var lb = $("#lightbox");
    lb.addEventListener("click", function () { lb.classList.add("oculto"); });

    var tapsKm = 0;
    var timerKm = null;
    var elKm = $(".mini-km");
    if (elKm) {
      elKm.addEventListener("click", function () {
        tapsKm++;
        if (timerKm) clearTimeout(timerKm);
        timerKm = setTimeout(function () {
          if (tapsKm >= 5) sumarKmPrueba();
          tapsKm = 0;
        }, 600);
      });
    }

    var tapsIntro = 0;
    var timerIntro = null;
    var elIntro = $(".intro-card");
    if (elIntro) {
      elIntro.addEventListener("click", function () {
        tapsIntro++;
        if (timerIntro) clearTimeout(timerIntro);
        timerIntro = setTimeout(function () {
          if (tapsIntro >= 5) probarEvento();
          tapsIntro = 0;
        }, 600);
      });
    }
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      ocultoEn = Date.now();
      guardar();
      return;
    }
    /* Al volver: se reabre lo que quedó pendiente y se retoma la finalización
       que se había quedado esperando en segundo plano. */
    if (estado.finalizado || !estado.iniciado) return;
    if (estado.pos) dibujarMapa();
    siguienteEvento();
    intentarFinal();
  });
  window.addEventListener("pagehide", guardar);

  /* ======================== INIT ======================== */
  function init() {
    aplicarTextos();
    bindear();
    if (estado.finalizado) {
      mostrarPantalla("pantalla-final");
      renderRecuerdos();
      cargarLeaflet(dibujarMapaFinal);
      return;
    }
    if (estado.iniciado && estado.pos) {
      mostrarPantalla("pantalla-viaje");
      renderKm();
      cargarLeaflet();
      iniciarGps();
      renderRecuerdos();
      /* Eventos que quedaron a medio ver antes de que la app se suspendiera. */
      siguienteEvento();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();