(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var LS_CLAVE = "cumpleAventura_v3";
  var CFG = (typeof CONFIG !== "undefined") ? CONFIG : null;

  if (!CFG) { console.error("config.js no cargó"); return; }

  /* ======================== ESTADO ======================== */
  function estadoInicial() {
    return {
      iniciado: false, pos: null, track: [], km: 0,
      vistas: [], hitoFotos: [], destinosVistos: [], destinoFotos: []
    };
  }

  function cargar() {
    try {
      return Object.assign(estadoInicial(), JSON.parse(localStorage.getItem(LS_CLAVE)));
    } catch (e) { return estadoInicial(); }
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
    $("#btn-subir-recuerdo").textContent = CFG.textoSubirFoto;
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

    if (estado.track.length > 1) {
      var pts = estado.track.map(function (p) { return [p.lat, p.lon]; });
      window.L.polyline(pts, { color: "#a9c3a0", weight: 5, opacity: 0.9 }).addTo(capaDinamica);
    }
    window.L.circleMarker([estado.pos.lat, estado.pos.lon],
      { radius: 9, color: "#ffffff", fillColor: "#d65296", fillOpacity: 1, weight: 3 }).addTo(capaDinamica);

    capaDinamica.addTo(mapaObj);
    if (siguiendo) mapaObj.setView([estado.pos.lat, estado.pos.lon], mapaObj.getZoom() || 13);
    setTimeout(function () { if (mapaObj) mapaObj.invalidateSize(); }, 150);
  }

  function cargarLeaflet() {
    if (window.L) { dibujarMapa(); return; }
    var css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    var sc = document.createElement("script");
    sc.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    sc.onload = dibujarMapa;
    document.body.appendChild(sc);
  }

  /* ======================== GPS ======================== */
  var watcher = null;
  var ultimoProceso = 0;

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
        agregarTramo(estado.pos, p, d);
      },
      function (err) {
        if (err && err.code === 1) mostrarErrorGps(CFG.textoSinGps);
        else if (!err || err.code !== 3) mostrarErrorGps("Todavía no tengo señal. Sigo intentando…");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  function agregarTramo(desde, hasta, d) {
    estado.pos = hasta;
    estado.km += d;
    estado.track.push(hasta);
    if (estado.track.length > 6000) estado.track.splice(0, estado.track.length - 6000);
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
  var cola = [];
  var modalAbierto = false;
  var contextoFoto = null;

  function revisarEventos() {
    var algo = false;

    CFG.hitos.forEach(function (h, i) {
      if (estado.vistas.indexOf(i) === -1 && estado.km >= h.km * 1000) {
        estado.vistas.push(i);
        cola.push({ tipo: "pista", idx: i });
        algo = true;
      }
    });

    CFG.destinos.forEach(function (d, i) {
      if (estado.destinosVistos.indexOf(i) === -1 && estado.km >= d.km * 1000) {
        estado.destinosVistos.push(i);
        cola.push({ tipo: "destino", idx: i });
        algo = true;
      }
    });

    if (algo) { guardar(); siguienteEvento(); }
    actualizarBotonTerminar();
  }

  function siguienteEvento() {
    if (modalAbierto || cola.length === 0) return;
    abrirEvento(cola.shift());
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
    $("#m-sello").textContent = sello;
    $("#m-titulo").textContent = titulo || "";
    $("#m-texto").textContent = mensaje || "";
    var btnFoto = $("#m-subir-foto");
    btnFoto.classList.toggle("oculto", !conFoto);
    $("#modal-evento").classList.add("abierto");
  }

  function cerrarEvento() {
    modalAbierto = false;
    contextoFoto = null;
    $("#modal-evento").classList.remove("abierto");
    siguienteEvento();
  }

  function actualizarBotonTerminar() {
    var todosVistos = CFG.hitos.every(function (h) {
      return estado.vistas.indexOf(CFG.hitos.indexOf(h)) !== -1;
    });
    var destinosVistos = CFG.destinos.every(function (d) {
      return estado.destinosVistos.indexOf(CFG.destinos.indexOf(d)) !== -1;
    });
    var ultimoDestinoFoto = false;
    if (CFG.destinos.length) {
      ultimoDestinoFoto = estado.destinoFotos.indexOf(CFG.destinos.length - 1) !== -1;
    }
    $("#btn-terminar").classList.toggle("oculto", !(todosVistos && destinosVistos && !ultimoDestinoFoto));
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

      if (esUltimoDestino) {
        setTimeout(finalizar, 300);
      } else {
        renderRecuerdos();
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
    if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
    mostrarPantalla("pantalla-final");
    renderRecuerdos();
    dibujarMapaFinal();
  }

  function dibujarMapaFinal() {
    if (!window.L) return;
    var wrap = $("#mapa-final-wrap");
    wrap.classList.remove("oculto");

    if (!mapaFinal) {
      mapaFinal = window.L.map("mapa-final").setView([-34.6, -58.4], 10);
      window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "&copy; Esri"
      }).addTo(mapaFinal);
    }

    var grupo = window.L.layerGroup().addTo(mapaFinal);

    if (estado.track.length > 1) {
      var pts = estado.track.map(function (p) { return [p.lat, p.lon]; });
      window.L.polyline(pts, { color: "#e8a0b4", weight: 5, opacity: 0.9 }).addTo(grupo);
    }

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
    });
  }

  /* ======================== LIGHTBOX ======================== */
  function abrirLightbox(src) {
    $("#lightbox-img").src = src;
    $("#lightbox").classList.remove("oculto");
  }

  /* ======================== ERRORES GPS ======================== */
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
    try { localStorage.removeItem(LS_CLAVE); } catch (e) {}
    limpiarFotos(function () { location.reload(); });
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
      if (ev.tipo === "pista") { estado.vistas.push(ev.idx); guardar(); }
      if (ev.tipo === "destino") { estado.destinosVistos.push(ev.idx); guardar(); }
      abrirEvento(ev);
      actualizarBotonTerminar();
    }
  }

  function bindear() {
    $("#btn-empezar").addEventListener("click", empezar);

    $("#btn-reintentar").addEventListener("click", function () {
      if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
      ocultarErrorGps();
      iniciarGps();
    });

    $("#m-subir-foto").addEventListener("click", pedirFoto);
    $("#btn-subir-recuerdo").addEventListener("click", pedirFoto);
    $("#m-cerrar").addEventListener("click", cerrarEvento);
    $("#input-foto").addEventListener("change", function () {
      procesarArchivo(this.files && this.files[0]);
    });

    $("#btn-terminar").addEventListener("click", finalizar);
    $("#btn-reiniciar").addEventListener("click", reiniciar);

    var lb = $("#lightbox");
    lb.addEventListener("click", function () { lb.classList.add("oculto"); });

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
    if (document.hidden) guardar();
  });
  window.addEventListener("pagehide", guardar);

  /* ======================== INIT ======================== */
  function init() {
    aplicarTextos();
    bindear();
    actualizarBotonTerminar();
    if (estado.iniciado && estado.pos) {
      mostrarPantalla("pantalla-viaje");
      renderKm();
      cargarLeaflet();
      iniciarGps();
      renderRecuerdos();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();