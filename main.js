(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var LS_CLAVE = "cumpleAventura_v3";
  var CFG = (typeof CONFIG !== "undefined") ? CONFIG : null;

  if (!CFG) { console.error("config.js no cargó"); return; }

  /* ======================== ESTADO ======================== */
  function estadoInicial() {
    return {
      iniciado: false, pos: null, track: [], km: 0, saltos: [], huecosResueltos: [],
      vistas: [], hitoFotos: [], destinosVistos: [], destinoFotos: [], respuestas: [],
      pendientes: [], finalizado: false
    };
  }

  var ARRAYS = ["track", "saltos", "huecosResueltos", "vistas", "hitoFotos", "destinosVistos", "destinoFotos", "respuestas", "pendientes"];

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

  /* Cada salto deja un tramo sin medir: el par de puntos justo antes y justo
     después. No se dibujan como recta, se piden como ruta real (ver OSRM). */
  function huecos() {
    var out = [];
    estado.saltos.forEach(function (i) {
      if (i > 0 && i < estado.track.length) out.push([estado.track[i - 1], estado.track[i]]);
    });
    return out;
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
  var HUECO_MIN_M = 120;        /* más corto que esto, la recta no se nota */
  var INTENTOS_HUECO = 3;
  var OSRM_TIMEOUT_MS = 8000;
  var OSRM_ESPERA_MS = 1100;    /* el servidor público pide no pasar de 1 req/s */

  var mapaObj = null;
  var capaDinamica = null;
  var siguiendo = true;

  /* ======================== RUTAS DE LOS HUECOS (OSRM) ========================
     Un hueco es un tramo que no medimos. No se dibuja como recta porque sería
     inventar el camino: se le pide a OSRM la ruta real entre los dos puntos.
     Si el servicio no responde, el tramo queda punteado y el mapa sigue siendo
     honesto. */
  var registroHuecos = {};   /* clave -> { n: intentos, cola: bool, volando: bool } */
  var colaOsrm = [];
  var osrmOcupado = false;

  function claveHueco(a, b) {
    return a.lat.toFixed(5) + "," + a.lon.toFixed(5) + ">" + b.lat.toFixed(5) + "," + b.lon.toFixed(5);
  }

  function buscarHuecoResuelto(a, b) {
    var clave = claveHueco(a, b);
    for (var i = 0; i < estado.huecosResueltos.length; i++) {
      if (estado.huecosResueltos[i].k === clave) return estado.huecosResueltos[i].pts;
    }
    return null;
  }

  function encolarHueco(a, b) {
    if (buscarHuecoResuelto(a, b)) return;
    var clave = claveHueco(a, b);
    var reg = registroHuecos[clave];
    if (reg && (reg.cola || reg.volando)) return;
    if (reg && reg.n >= INTENTOS_HUECO) return;
    if (!reg) reg = registroHuecos[clave] = { n: 0, cola: false, volando: false };
    reg.n++;
    reg.cola = true;
    colaOsrm.push({ clave: clave, reg: reg, a: a, b: b });
    procesarColaOsrm();
  }

  function procesarColaOsrm() {
    if (osrmOcupado) return;
    var item = colaOsrm.shift();
    if (!item) return;
    item.reg.cola = false;
    item.reg.volando = true;
    osrmOcupado = true;
    /* Un throw sincronico (por ejemplo un config.js viejo cacheado sin la lista
       de servicios) no puede dejar la cola trabada para siempre. */
    var pedido;
    try { pedido = pedirRutaOsrm(item.a, item.b); }
    catch (e) { pedido = Promise.reject(e); }
    pedido.then(function (pts) {
      estado.huecosResueltos.push({ k: item.clave, pts: pts });
      if (estado.huecosResueltos.length > 300) {
        estado.huecosResueltos.splice(0, estado.huecosResueltos.length - 300);
      }
      guardar();
      /* El mapa en vivo se redibuja cada tanto y toma la ruta sola; el final
         está quieto, así que hay que avisarle. */
      if (mapaFinal) renderFinal();
    })["catch"](function () { /* sin ruta: sigue punteado */ })
      .then(function () {
        item.reg.volando = false;
        osrmOcupado = false;
        setTimeout(procesarColaOsrm, OSRM_ESPERA_MS);
      });
  }

  function pedirRutaOsrm(a, b) {
    if (!CFG.osrm || !CFG.osrm.length) {
      return Promise.reject(new Error("no hay servicio de rutas configurado"));
    }
    var extremos = a.lon.toFixed(6) + "," + a.lat.toFixed(6) + ";" + b.lon.toFixed(6) + "," + b.lat.toFixed(6);
    var i = 0;

    function intentar() {
      if (i >= CFG.osrm.length) return Promise.reject(new Error("OSRM no disponible"));
      var url = CFG.osrm[i++] + "/" + extremos + "?overview=full&geometries=geojson";
      var ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, OSRM_TIMEOUT_MS);
      return fetch(url, ctrl ? { signal: ctrl.signal } : undefined)
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.json();
        })
        .then(function (j) {
          clearTimeout(t);
          if (!j || j.code !== "Ok" || !j.routes || !j.routes.length) throw new Error("sin ruta");
          /* GeoJSON viene como [lon, lat] y Leaflet quiere [lat, lon]. */
          return j.routes[0].geometry.coordinates.map(function (c) {
            return [+c[1].toFixed(5), +c[0].toFixed(5)];
          });
        })
        ["catch"](function (e) {
          clearTimeout(t);
          return intentar();
        });
    }

    return intentar();
  }

  /* Dibuja el recorrido en cualquier capa: lo medido en sólido, los huecos como
     ruta real si se pudo calcular y punteados mientras tanto. */
  function pintarRecorrido(capa, color) {
    tramosTrack().forEach(function (tramo) {
      if (tramo.length < 2) return;
      window.L.polyline(tramo.map(function (p) { return [p.lat, p.lon]; }),
        { color: color, weight: 5, opacity: 0.9 }).addTo(capa);
    });

    huecos().forEach(function (h) {
      var a = h[0], b = h[1];
      var resuelta = buscarHuecoResuelto(a, b);
      if (resuelta && resuelta.length > 1) {
        window.L.polyline(resuelta, { color: color, weight: 5, opacity: 0.9 }).addTo(capa);
        return;
      }
      if (haversine(a, b) >= HUECO_MIN_M) encolarHueco(a, b);
      window.L.polyline([[a.lat, a.lon], [b.lat, b.lon]],
        { color: color, weight: 3, opacity: 0.5, dashArray: "6 8" }).addTo(capa);
    });
  }

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

    pintarRecorrido(capaDinamica, "#a9c3a0");

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
  var ultimaFijacion = 0;
  var ULTIMO_PROCESO_MS = 2000;
  var MOVIMIENTO_MIN_M = 10;
  var V_MAX_MPS = 60;       /* 216 km/h: más rápido que eso no es un auto, es un salto del GPS */
  var MAX_HUECO_S = 120;    /* sin muestras por tanto tiempo, la recta sería inventada */

  function iniciarGps() {
    if (watcher !== null) return;
    if (!navigator.geolocation) { mostrarErrorGps(CFG.textoSinGps); return; }
    ultimaFijacion = Date.now();
    watcher = navigator.geolocation.watchPosition(
      function (pos) {
        ocultarErrorGps();
        var p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (!estado.pos) {
          estado.pos = p; ultimaFijacion = Date.now(); guardar(); dibujarMapa(); return;
        }
        var ahora = Date.now();
        /* Toda muestra cuenta para el reloj aunque después se descarte por poco
           movimiento: si no, el tiempo sin datos se acumula de más y un tramo
           totalmente normal en segundo plano terminaria marcado como hueco. */
        var dt = (ahora - ultimaFijacion) / 1000;
        ultimaFijacion = ahora;
        if (ahora - ultimoProceso < ULTIMO_PROCESO_MS) return;
        var d = haversine(estado.pos, p);
        if (d < MOVIMIENTO_MIN_M) return;
        ultimoProceso = ahora;

        /* Un tramo se marca como hueco si la velocidad implausible no puede ser
           un auto, o si pasamos demasiado tiempo sin muestras. Los kilómetros
           se suman siempre; lo que no se dibuja como recta se calcula como ruta. */
        var velocidad = dt > 0 ? d / dt : Infinity;
        var salto = velocidad > V_MAX_MPS || dt > MAX_HUECO_S;

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
  var eventoConFoto = false;

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
    /* Con un evento abierto todavía no: se finaliza al cerrarlo, para que las
       varias fotos de la última parada se puedan subir antes. */
    if (modalAbierto) return false;
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
    eventoConFoto = conFoto;
    $("#m-sello").textContent = sello;
    $("#m-sello").classList.toggle("oculto", ev.tipo === "destino");
    $("#m-titulo").textContent = titulo || "";
    $("#m-texto").textContent = mensaje || "";
    var btnFoto = $("#m-subir-foto");
    btnFoto.classList.toggle("oculto", !conFoto);
    /* En el último destino el botón cierra el recorrido, así que avisa. */
    var ultimo = ev.tipo === "destino" && ev.idx === CFG.destinos.length - 1;
    $("#m-cerrar").textContent = ultimo
      ? (CFG.textoListo || CFG.textoSeguir || "Listo")
      : (CFG.textoSeguir || "Seguir");
    var inp = $("#m-input");
    var conInput = ev.tipo === "pista" && !!CFG.hitos[ev.idx].input;
    inp.classList.toggle("oculto", !conInput);
    if (conInput) {
      inp.value = estado.respuestas[ev.idx] || "";
      inp.placeholder = CFG.hitos[ev.idx].placeholder || "";
    }
    $("#modal-evento").classList.add("abierto");
    contarFotosDeEvento(ev, function (n) { pintarFotosModal(n); });
  }

  /* ======================== FOTOS ======================== */
  /* Cada foto guarda a qué evento pertenece (tipo + idx). Eso permite varias
     fotos por evento y agruparlas después para dibujar un solo marcador con
     contador. Las fotos viejas no lo tienen y quedan en su propio grupo. */
  function contarFotosDeEvento(ev, cb) {
    if (!ev) { cb(0); return; }
    todasFotos(function (fotos) {
      var n = fotos.filter(function (f) { return f.tipo === ev.tipo && f.idx === ev.idx; }).length;
      cb(n);
    });
  }

  function pintarFotosModal(n) {
    var cont = $("#m-fotos");
    if (!eventoConFoto || !n) {
      cont.classList.add("oculto");
    } else {
      cont.textContent = (CFG.textoFotosGuardadas || "{n} recuerdo(s) 📷").replace("{n}", n);
      cont.classList.remove("oculto");
    }
    $("#m-subir-foto").textContent = n
      ? (CFG.textoAgregarFoto || "Agregar otra 📸")
      : (CFG.textoSubirFoto || "Subir recuerdo 📸");
  }

  function cerrarEvento() {
    var ev = eventoActual;
    if (ev && ev.tipo === "pista" && !$("#m-input").classList.contains("oculto")) {
      var v = $("#m-input").value.trim();
      if (v && estado.respuestas[ev.idx] !== v) {
        estado.respuestas[ev.idx] = v;
        guardar();
      }
    }
    /* El evento recién se da por visto cuando se cierra: si la app se suspende
       con el modal abierto, sigue en la cola y reaparece al volver. */
    for (var i = estado.pendientes.length - 1; i >= 0; i--) {
      var p = estado.pendientes[i];
      if (ev && p.tipo === ev.tipo && p.idx === ev.idx) {
        estado.pendientes.splice(i, 1);
      }
    }
    marcarVisto(ev);
    modalAbierto = false;
    contextoFoto = null;
    eventoActual = null;
    $("#modal-evento").classList.remove("abierto");
    guardar();

    /* El último destino cierra el recorrido, y se cierra recién cuando el
       usuario aprieta "Listo": sacar la primera foto ya no lo termina, porque
       ahora se pueden subir varias. Sin foto no se cierra solo, para no perder
       el recuerdo; queda el botón de terminar recorrido por si la cámara falla. */
    var cierraViaje = ev && ev.tipo === "destino" && ev.idx === CFG.destinos.length - 1 &&
      estado.destinoFotos.indexOf(ev.idx) !== -1;

    /* Con la app en segundo plano no se finaliza nada: se retoma al volver. */
    if (document.hidden) { siguienteEvento(); return; }
    if (cierraViaje) { setTimeout(finalizar, 300); return; }

    siguienteEvento();
    if (!intentarFinal()) actualizarBotonTerminar();
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
  var fotoAbriendo = false;

  function pedirFoto() {
    /* Un toque doble abriría dos selectores de archivo. Si el usuario
       cancela no se dispara ningún evento, así que el bloqueo se suelta solo. */
    if (fotoAbriendo) return;
    fotoAbriendo = true;
    setTimeout(function () { fotoAbriendo = false; }, 1000);
    var input = $("#input-foto");
    input.value = "";
    input.click();
  }

  function procesarArchivo(file) {
    if (!file) return;
    fotoAbriendo = false;
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
      tipo: ev ? ev.tipo : null,
      idx: ev ? ev.idx : null,
      dataUrl: dataUrl
    };

    guardarFoto(foto, function () {
      if (ev && ev.tipo === "pista" && estado.hitoFotos.indexOf(ev.idx) === -1) estado.hitoFotos.push(ev.idx);
      if (ev && ev.tipo === "destino" && estado.destinoFotos.indexOf(ev.idx) === -1) estado.destinoFotos.push(ev.idx);
      guardar();

      /* El modal sigue abierto: se pueden subir varias fotos del mismo evento.
         El recorrido ya no se cierra acá, se cierra al apretar "Listo". */
      contarFotosDeEvento(ev, function (n) { pintarFotosModal(n); });
      renderRecuerdos();
      if (!intentarFinal()) actualizarBotonTerminar();
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

  /* Las fotos se agrupan por evento para que las varias de una misma parada se
     dibujen en un solo marcador con contador. Las fotos viejas no guardan a qué
     evento pertenecían, así que cada una queda en su propio grupo. */
  function agruparFotos(fotos) {
    var grupos = [], porClave = {}, sueltos = 0;
    fotos.forEach(function (f) {
      var clave = (f.tipo != null && f.idx != null)
        ? f.tipo + ":" + f.idx
        : "suelta:" + (f.id != null ? f.id : "x" + sueltos++);
      if (!porClave[clave]) {
        porClave[clave] = { fotos: [] };
        grupos.push(porClave[clave]);
      }
      porClave[clave].fotos.push(f);
    });
    return grupos;
  }

  /* ======================== FINAL ======================== */
  var mapaFinal = null;
  var grupoFinal = null;
  var renderFinalToken = 0;
  var encajadoFinal = false;

  function finalizar() {
    if (estado.finalizado) return;
    estado.finalizado = true;
    wakePedido = false;
    soltarWake();
    guardar();
    if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
    mostrarPantalla("pantalla-final");
    renderRecuerdos();
    dibujarMapaFinal();
  }

  function dibujarMapaFinal() {
    if (!window.L) { cargarLeaflet(dibujarMapaFinal); return; }
    if (mapaFinal) { renderFinal(); return; }
    var wrap = $("#mapa-final-wrap");
    wrap.classList.remove("oculto");

    mapaFinal = window.L.map("mapa-final").setView([-34.6, -58.4], 10);
    window.L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, attribution: "&copy; Esri"
    }).addTo(mapaFinal);
    grupoFinal = window.L.layerGroup().addTo(mapaFinal);
    renderFinal();
  }

  /* Se vuelve a correr cada vez que OSRM responde un hueco, para que la ruta
     real reemplace al tramo punteado. El encuadre se hace una sola vez. */
  function renderFinal() {
    if (!mapaFinal) return;
    var token = ++renderFinalToken;
    grupoFinal.clearLayers();

    pintarRecorrido(grupoFinal, "#e8a0b4");

    var bounds = [];
    estado.track.forEach(function (p) { bounds.push([p.lat, p.lon]); });
    if (estado.pos) bounds.push([estado.pos.lat, estado.pos.lon]);

    todasFotos(function (fotos) {
      if (token !== renderFinalToken) return;
      agruparFotos(fotos).forEach(function (g) {
        /* Varias fotos pueden caer en el mismo instante si el GPS titila: se
           dibuja la primera que sí tenga posición. */
        var conPos = g.fotos.filter(function (f) { return f.lat !== null && f.lon !== null; });
        if (!conPos.length) return;
        var html = '<img src="' + conPos[0].dataUrl + '">' +
          (g.fotos.length > 1 ? '<span class="foto-n">' + g.fotos.length + "</span>" : "");
        var ic = window.L.divIcon({
          className: "foto-ic",
          html: html,
          iconSize: [56, 56],
          iconAnchor: [28, 28]
        });
        var mk = window.L.marker([conPos[0].lat, conPos[0].lon], { icon: ic }).addTo(grupoFinal);
        mk.on("click", function () { abrirLightbox(conPos[0].dataUrl); });
        bounds.push([conPos[0].lat, conPos[0].lon]);
      });

      if (!encajadoFinal && bounds.length) {
        mapaFinal.fitBounds(bounds, { padding: [40, 40] });
        encajadoFinal = true;
      }
    });

    setTimeout(function () { if (mapaFinal) mapaFinal.invalidateSize(); }, 150);
  }

  /* ======================== LIGHTBOX ======================== */
  function abrirLightbox(src) {
    $("#lightbox-img").src = src;
    $("#lightbox").classList.remove("oculto");
  }

  /* ======================== PANTALLA ENCENDIDA ========================
     Con la pantalla apagada el navegador congela la página y se terminan
     perdiendo los puntos del recorrido. Con la pantalla encendida la app sigue
     corriendo; el auto suele tener el celular montado y cargando. */
  var wakeLock = null;
  var wakePedido = false;
  var wakeSoportado = ("wakeLock" in navigator);

  function pedirWake() {
    if (!wakeSoportado || wakeLock || document.hidden) { pintarWake(); return Promise.resolve(); }
    return navigator.wakeLock.request("screen").then(function (s) {
      wakeLock = s;
      /* El navegador lo suelta solo al ocultar la pestaña: hay que repedirlo. */
      s.addEventListener("release", function () { wakeLock = null; pintarWake(); });
      pintarWake();
    })["catch"](function () { pintarWake(); });
  }

  function soltarWake() {
    var s = wakeLock;
    wakeLock = null;
    if (s && s.release) s.release()["catch"](function () {});
    pintarWake();
  }

  function pintarWake() {
    var btn = $("#btn-wake");
    if (!btn) return;
    /* Si el config.js cacheadoTodavia no tiene los textos, no se muestra el
       boton antes que un "undefined" en pantalla. */
    if (!wakeSoportado || !CFG.textoWakeOn || !CFG.textoWakeOff) {
      btn.classList.add("oculto");
      return;
    }
    btn.classList.remove("oculto");
    btn.classList.toggle("activo", !!wakeLock);
    btn.textContent = wakeLock ? CFG.textoWakeOn : CFG.textoWakeOff;
  }

  function alternarWake() {
    wakePedido = !wakePedido;
    if (wakePedido) pedirWake(); else soltarWake();
    pintarWake();
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

    var btnWake = $("#btn-wake");
    if (btnWake) btnWake.addEventListener("click", alternarWake);

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
      guardar();
      return;
    }
    /* Al volver: se reabre lo que quedó pendiente y se retoma la finalización
       que se había quedado esperando en segundo plano. */
    if (wakePedido) pedirWake();
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
    pintarWake();
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