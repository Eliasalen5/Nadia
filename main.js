(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var LS_CLAVE = "cumpleAventura_v4";
  var LS_CLAVE_VIEJA = "cumpleAventura_v3";
  var LS_HISTORIAL = "cumpleAventura_recorridos";
  var HISTORIAL_MAX = 8;         /* cuántos recorridos terminados se conservan */
  var TRACK_ARCHIVO_M = 100;     /* el track guardado se adelgaza a 1 punto cada 100 m */
  var CFG = (typeof CONFIG !== "undefined") ? CONFIG : null;

  if (!CFG) { console.error("config.js no cargó"); return; }

  /* ======================== ESTADO ========================
     Cada evento se identifica por su km y nunca por su posición en la lista.
     Si mañana se agrega, se corre o se borra una parada, los índices cambian
     pero los kilómetros no, así que el progreso guardado sigue apuntando a lo
     que estaba apontando. Para traducir lo que guardaban las versiones viejas
     (que sí usaban índices) hace falta saber cómo estaba cada lista en ese
     momento: eso es FIRMA_VIEJA. */
  var FIRMA_VIEJA = { hitos: [30, 100], destinos: [125] };
  /* La versión que permitió varias fotos por parada también guardaba el índice de
     la parada, pero con la lista de cuatro pistas: un índice viejo puede tener dos
     lecturas distintas (kmDeFoto resuelve cuál con lo que el recorrido ya registró). */
  var FIRMA_KM = { hitos: [20, 30, 100, 145], destinos: [125, 187] };

  function nuevoId() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function estadoInicial() {
    return {
      id: nuevoId(),
      iniciado: false, pos: null, track: [], km: 0, saltos: [], huecosResueltos: [],
      vistas: [], hitoFotos: [], destinosVistos: [], destinoFotos: [], respuestas: {},
      pendientes: [], finalizado: false, firma: null
    };
  }


  var ARRAYS = ["track", "saltos", "huecosResueltos", "vistas", "hitoFotos", "destinosVistos", "destinoFotos", "pendientes"];

  function firmaActual() {
    return { hitos: CFG.hitos.map(kmDe), destinos: CFG.destinos.map(kmDe) };
  }

  function kmDe(e) { return e.km; }

  function existeEn(lista, k) {
    for (var i = 0; i < lista.length; i++) if (lista[i].km === k) return true;
    return false;
  }

  /* Traduce índices viejos a kilómetros y descarta los que ya no están en el
     config (paradas borradas) o están repetidos. */
  function aKms(lista, valores, vieja, legacy) {
    if (!Array.isArray(valores)) return [];
    var vistos = {};
    return valores.map(function (v) {
      return (legacy && typeof v === "number") ? vieja[v] : v;
    }).filter(function (k) {
      if (typeof k !== "number" || !isFinite(k) || vistos[k]) return false;
      if (!existeEn(lista, k)) return false;
      vistos[k] = true;
      return true;
    });
  }

  function migrar(e, firmaGuardada, legacy) {
    var fh = (firmaGuardada && Array.isArray(firmaGuardada.hitos)) ? firmaGuardada.hitos : FIRMA_VIEJA.hitos;
    var fd = (firmaGuardada && Array.isArray(firmaGuardada.destinos)) ? firmaGuardada.destinos : FIRMA_VIEJA.destinos;

    e.vistas = aKms(CFG.hitos, e.vistas, fh, legacy);
    e.hitoFotos = aKms(CFG.hitos, e.hitoFotos, fh, legacy);
    e.destinosVistos = aKms(CFG.destinos, e.destinosVistos, fd, legacy);
    e.destinoFotos = aKms(CFG.destinos, e.destinoFotos, fd, legacy);

    e.pendientes = (Array.isArray(e.pendientes) ? e.pendientes : []).map(function (p) {
      if (!p || typeof p !== "object") return null;
      var esPista = p.tipo === "pista";
      var lista = esPista ? CFG.hitos : CFG.destinos;
      var vieja = esPista ? fh : fd;
      var nuevo = { tipo: p.tipo, km: legacy ? vieja[p.idx] : p.km };
      if (p.lat != null) nuevo.lat = p.lat;
      if (p.lon != null) nuevo.lon = p.lon;
      return existeEn(lista, nuevo.km) ? nuevo : null;
    }).filter(Boolean);

    /* Las respuestas viejas eran un array indexado por posición del hito. */
    var r = {};
    Object.keys(e.respuestas || {}).forEach(function (clave) {
      var nuevo = (/^\d+$/.test(clave) && legacy) ? fh[+clave] : +clave;
      if (existeEn(CFG.hitos, nuevo)) r[nuevo] = e.respuestas[clave];
    });
    e.respuestas = r;

    e.firma = firmaActual();
  }

  function cargar() {
    var base = estadoInicial();
    var crudo = null, eraViejo = false;
    try { crudo = localStorage.getItem(LS_CLAVE); } catch (e) {}
    if (!crudo) {
      try { crudo = localStorage.getItem(LS_CLAVE_VIEJA); eraViejo = !!crudo; } catch (e) {}
    }
    var guardado = null;
    try { guardado = crudo ? JSON.parse(crudo) : null; } catch (e) {}

    if (guardado && typeof guardado === "object") {
      Object.keys(base).forEach(function (k) {
        if (guardado[k] !== undefined) base[k] = guardado[k];
      });
    }
    ARRAYS.forEach(function (k) {
      if (!Array.isArray(base[k])) base[k] = [];
    });
    if (!base.respuestas || typeof base.respuestas !== "object") base.respuestas = {};
    if (!base.pos || typeof base.pos.lat !== "number" || typeof base.pos.lon !== "number") base.pos = null;
    if (typeof base.km !== "number" || !isFinite(base.km) || base.km < 0) base.km = 0;
    /* Un recorrido guardado antes de que existiera el historial no tiene id
       propio: se le da uno ahora, para que sus fotos sigan siendo de este. */
    if (typeof base.id !== "string" || !base.id) base.id = nuevoId();

    migrar(base, guardado && guardado.firma, eraViejo || !(guardado && guardado.firma));
    if (eraViejo) {
      escribir(base);
      try { localStorage.removeItem(LS_CLAVE_VIEJA); } catch (e) {}
    }
    return base;
  }

  /* El track se dibuja como tramos separados: un "salto" (pausa larga o teletransporte
     del GPS) suma kilómetros pero NO dibuja una recta falsa entre dos puntos lejanos.
     Recibe el recorrido a dibujar para que valga también con los ya terminados. */
  function tramosTrack(t) {
    t = t || estado;
    var tramos = [];
    var ini = 0;
    t.saltos.forEach(function (i) {
      if (i > ini && i < t.track.length) {
        tramos.push(t.track.slice(ini, i));
        ini = i;
      }
    });
    if (ini < t.track.length) tramos.push(t.track.slice(ini));
    return tramos;
  }

  /* Cada salto deja un tramo sin medir: el par de puntos justo antes y justo
     después. No se dibujan como recta, se piden como ruta real (ver OSRM). */
  function huecos(t) {
    t = t || estado;
    var out = [];
    t.saltos.forEach(function (i) {
      if (i > 0 && i < t.track.length) out.push([t.track[i - 1], t.track[i]]);
    });
    return out;
  }

  function escribir(e) {
    try { localStorage.setItem(LS_CLAVE, JSON.stringify(e)); }
    catch (err) { console.error("No se pudo guardar el progreso:", err); }
  }

  function guardar() { escribir(estado); }

  var estado = cargar();

  /* ======================== RECORRIDOS GUARDADOS ========================
     Cuando un recorrido termina queda guardado en el teléfono y se puede volver
     a abrir cuando se quiera. El recorrido en curso vive aparte, así que empezar
     uno nuevo no pisa el anterior ni sus recuerdos. */
  function leerHistorial() {
    try {
      var l = localStorage.getItem(LS_HISTORIAL);
      l = l ? JSON.parse(l) : null;
      if (!Array.isArray(l)) return [];
      return l.filter(function (t) {
        return t && typeof t.id === "string" && Array.isArray(t.track);
      });
    } catch (e) { return []; }
  }

  function escribirHistorial(lista) {
    while (lista.length > HISTORIAL_MAX) lista.pop();
    while (true) {
      try { localStorage.setItem(LS_HISTORIAL, JSON.stringify(lista)); return true; }
      catch (e) {
        /* Si no hay lugar se van los más viejos, pero el recorrido nuevo
           nunca se pierde: eso es lo que se acaba de hacer. */
        if (lista.length <= 1) return false;
        lista.pop();
      }
    }
  }

  function enHistorial(id) {
    var l = leerHistorial();
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return true;
    return false;
  }

  /* Un track de tres horas son miles de puntos: guardados así en cada recorrido
     llenan el almacenamiento y dejan de guardarse los kilómetros, las pistas y
     todo lo demás. Se guardan adelgazados, y los puntos que cortan un tramo sin
     medir se conservan siempre para que esos tramos sigan emparejando bien. */
  function adelgazarTrack(track, saltos, minM) {
    var nuevos = [], nuevosSaltos = [], esSalto = {}, i;
    if (!track.length) return { track: [], saltos: [] };
    for (i = 0; i < saltos.length; i++) esSalto[saltos[i]] = true;
    nuevos.push(track[0]);
    for (i = 1; i < track.length; i++) {
      var esUltimo = i === track.length - 1;
      if (esUltimo || esSalto[i] ||
          haversine(nuevos[nuevos.length - 1], track[i]) >= minM) {
        nuevos.push(track[i]);
        if (esSalto[i]) nuevosSaltos.push(nuevos.length - 1);
      }
    }
    return { track: nuevos, saltos: nuevosSaltos };
  }

  function archivar() {
    if (!estado.finalizado) return false;
    if (enHistorial(estado.id)) return false;
    var lista = leerHistorial();
    var delgado = adelgazarTrack(estado.track, estado.saltos, TRACK_ARCHIVO_M);
    lista.unshift({
      id: estado.id,
      cerrado: new Date().toISOString(),
      km: estado.km,
      pos: estado.pos,
      track: delgado.track,
      saltos: delgado.saltos,
      huecosResueltos: estado.huecosResueltos,
      respuestas: estado.respuestas,
      vistas: estado.vistas,
      destinosVistos: estado.destinosVistos
    });
    if (!escribirHistorial(lista)) {
      console.error("No se pudo guardar el recorrido terminado");
      return false;
    }
    /* Las fotos más viejas no saben a qué recorrido pertenecen: son de éste y se
       lo anotamos ahora, así no quedan colgando del recorrido que empiece después. */
    sellarFotos(estado.id, podarFotosSueltas);
    return true;
  }

  /* Si el historial se llena y se van los recorridos más viejos, sus recuerdos se
     van con ellos: si no, quedan ocupando lugar en el navegador sin que haya forma
     de verlos ni de borrarlos. */
  function podarFotosSueltas() {
    var vivos = {};
    vivos[estado.id] = true;
    leerHistorial().forEach(function (t) { vivos[t.id] = true; });
    recorrerFotos("readwrite", function (st, r) {
      (r.result || []).forEach(function (f) {
        if (f.id == null || f.recorrido == null || vivos[f.recorrido]) return;
        st["delete"](f.id);
      });
    });
  }

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
    ["pantalla-portada", "pantalla-viaje", "pantalla-historial", "pantalla-final"].forEach(function (t) {
      var el = $("#" + t);
      if (el) el.classList.toggle("oculto", t !== id);
    });
  }

  function aplicarTextos() {
    /* Un config.js viejo cacheado sin algún texto no puede dejar "undefined"
       escrito en pantalla. */
    $(".titulo").textContent = CFG.titulo || "";
    $(".frase").textContent = CFG.frase || "";
    $("#btn-empezar").textContent = CFG.textoBoton || "Empezar";
    $("#v-encabezado").textContent = CFG.textoEncabezado || "";
    $("#v-intro").textContent = CFG.textoIntroMapa || "";
    $("#v-buscando").textContent = CFG.textoBuscando || "";
    $("#btn-reintentar").textContent = CFG.textoReintentar || "Reintentar";
    $("#m-subir-foto").textContent = CFG.textoSubirFoto || "Subir recuerdo 📸";
    $("#m-cerrar").textContent = CFG.textoSeguir || "Seguir";
    $("#btn-terminar").textContent = CFG.textoTerminar || "Terminar recorrido 🏁";
    $("#f-mensaje").textContent = CFG.textoFinal || "";
    $("#btn-reiniciar").textContent = CFG.textoReiniciar || "Empezar de nuevo 🔄";
    $("#btn-volver").textContent = CFG.textoVolver || "Volver";
    $("#h-volver").textContent = CFG.textoVolver || "Volver";
    $("#h-titulo").textContent = CFG.textoHistorial || "Recorridos guardados";
    $("#h-vacio").textContent = CFG.textoSinRecorridos || "Todavía no hay recorridos terminados.";
    $("#c-titulo").textContent = CFG.textoConfirmar || "¿Empezar de nuevo?";
    $("#c-si").textContent = CFG.textoSi || "Sí, dale";
    $("#c-no").textContent = CFG.textoNo || "Ahora no";
  }

  /* Botones de acceso al historial: si no hay recorridos terminados no se
     muestran, para que la portada siga siendo la del regalo. */
  function actualizarBotonesRecorridos() {
    var n = leerHistorial().length;
    $$(".js-recorridos").forEach(function (b) {
      b.classList.toggle("oculto", n === 0);
      b.textContent = (CFG.textoRecorridos || "Recorridos guardados ({n})").replace("{n}", n);
    });
  }

  /* ======================== INDEXEDDB (fotos) ======================== */
  var DB = null;
  var dbFallo = false;

  /* El callback siempre se llama, y siempre con si se pudo o no: antes, si la
     base no abría, el contador de fotos y el guardado quedaban esperando para
     siempre sin decir nada. */
  function abrirDb(cb) {
    if (DB) { cb(true); return; }
    if (dbFallo) { cb(false); return; }
    var req;
    try { req = indexedDB.open("cumple_aventura", 1); }
    catch (e) { dbFallo = true; cb(false); return; }
    var dicho = false;
    function listo(ok) { if (dicho) return; dicho = true; cb(ok); }
    req.onupgradeneeded = function () {
      if (!req.result.objectStoreNames.contains("fotos")) {
        req.result.createObjectStore("fotos", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = function () {
      DB = req.result;
      /* Otra pestaña que actualiza la base: esta se cierra para no trabarla. */
      DB.onversionchange = function () { DB.close(); DB = null; };
      listo(true);
    };
    /* Otra pestaña con una versión vieja deja la apertura esperando para
       siempre: sin esto, en esa página ninguna foto se guarda ni se cuenta. */
    req.onblocked = function () { dbFallo = true; console.error("IndexedDB bloqueada por otra pestaña"); listo(false); };
    req.onerror = function () { dbFallo = true; console.error("IndexedDB no disponible"); listo(false); };
  }

  function guardarFoto(foto, cb) {
    abrirDb(function (ok) {
      if (!ok) { cb(false); return; }
      var tx;
      try { tx = DB.transaction("fotos", "readwrite"); }
      catch (e) { cb(false); return; }
      tx.objectStore("fotos").add(foto);
      tx.oncomplete = function () { cb(true); };
      tx.onerror = tx.onabort = function () { console.error("No se pudo guardar la foto", tx.error); cb(false); };
    });
  }

  function todasFotos(cb) {
    abrirDb(function (ok) {
      if (!ok) { cb([]); return; }
      var tx;
      try { tx = DB.transaction("fotos", "readonly"); }
      catch (e) { cb([]); return; }
      var r = tx.objectStore("fotos").getAll();
      r.onsuccess = function () { cb(r.result || []); };
      r.onerror = function () { cb([]); };
    });
  }

  /* Recorre todas las fotos dentro de una transacción de escritura. */
  function recorrerFotos(tipo, porCada, cb) {
    abrirDb(function (ok) {
      if (!ok) { if (cb) cb(); return; }
      var tx;
      try { tx = DB.transaction("fotos", tipo); }
      catch (e) { if (cb) cb(); return; }
      var st = tx.objectStore("fotos");
      var r = st.getAll();
      r.onsuccess = function () {
        try { porCada(st, r); }
        catch (e) { console.error("No se pudo tocar la base de fotos:", e); }
      };
      tx.oncomplete = function () { if (cb) cb(); };
      tx.onerror = tx.onabort = function () { if (cb) cb(); };
    });
  }

  function sellarFotos(id, cb) {
    recorrerFotos("readwrite", function (st, r) {
      (r.result || []).forEach(function (f) {
        if (f.recorrido != null || f.id == null) return;
        f.recorrido = id;
        st.put(f);
      });
    }, cb);
  }

  function borrarFotosDelRecorrido(id, cb) {
    recorrerFotos("readwrite", function (st, r) {
      (r.result || []).forEach(function (f) {
        if (f.id != null && fotoEsDe(f, id)) st["delete"](f.id);
      });
    }, cb);
  }

  /* ======================== MAPA (Leaflet) ======================== */
  var HUECO_MIN_M = 120;        /* más corto que esto, la recta no se nota */
  var INTENTOS_HUECO = 3;
  var OSRM_TIMEOUT_MS = 8000;
  var OSRM_ESPERA_MS = 1100;    /* el servidor público pide no pasar de 1 req/s */
  var RUTA_MIN_M = 20;          /* un punto cada 20 m alcanza para dibujar */
  var RUTA_MAX_HUECOS = 200;
  var RUTA_MAX_PUNTOS = 3000;

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

  function buscarHuecoResuelto(a, b, t) {
    t = t || estado;
    var clave = claveHueco(a, b);
    for (var i = 0; i < t.huecosResueltos.length; i++) {
      if (t.huecosResueltos[i].k === clave) return t.huecosResueltos[i].pts;
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
      estado.huecosResueltos.push({ k: item.clave, pts: simplificarRuta(pts) });
      acapararRutas();
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

  /* OSRM devuelve cientos de puntos por tramo. Guardados tal cual llenan el
     localStorage en un rato, y cuando se llena deja de guardarse TODO el
     progreso (km, track, respuestas). Se guardan ya adelgazados y con un tope
     de puntos, así el guardado nunca es lo que se rompe. */
  function simplificarRuta(pts) {
    if (!pts || pts.length < 3) return (pts || []).slice(0, 2);
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      if (haversine(out[out.length - 1], pts[i]) >= RUTA_MIN_M) out.push(pts[i]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function acapararRutas() {
    var total = 0;
    for (var i = 0; i < estado.huecosResueltos.length; i++) {
      total += estado.huecosResueltos[i].pts.length;
    }
    while (estado.huecosResueltos.length > 1 &&
      (estado.huecosResueltos.length > RUTA_MAX_HUECOS || total > RUTA_MAX_PUNTOS)) {
      total -= estado.huecosResueltos.shift().pts.length;
    }
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
      /* Si el navegador no tiene AbortController el pedido se queda esperando
         para siempre y con él toda la cola de huecos: el reloj corta igual. */
      var reloj = new Promise(function (res, rej) {
        setTimeout(function () { rej(new Error("tiempo agotado")); }, OSRM_TIMEOUT_MS);
      });
      return Promise.race([
        fetch(url, ctrl ? { signal: ctrl.signal } : undefined),
        reloj
      ])
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
        })["catch"](function (e) {
          clearTimeout(t);
          return intentar();
        });
    }

    return intentar();
  }

  /* Dibuja el recorrido en cualquier capa: lo medido en sólido, los huecos como
     ruta real si se pudo calcular y punteados mientras tanto. Un recorrido ya
     terminado se dibuja tal cual: no se le piden rutas nuevas a OSRM. */
  function pintarRecorrido(capa, color, t, resolver) {
    t = t || estado;
    tramosTrack(t).forEach(function (tramo) {
      if (tramo.length < 2) return;
      window.L.polyline(tramo.map(function (p) { return [p.lat, p.lon]; }),
        { color: color, weight: 5, opacity: 0.9 }).addTo(capa);
    });

    huecos(t).forEach(function (h) {
      var a = h[0], b = h[1];
      var resuelta = buscarHuecoResuelto(a, b, t);
      if (resuelta && resuelta.length > 1) {
        window.L.polyline(resuelta, { color: color, weight: 5, opacity: 0.9 }).addTo(capa);
        return;
      }
      if (resolver !== false && haversine(a, b) >= HUECO_MIN_M) encolarHueco(a, b);
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

    pintarRecorrido(capaDinamica, "#a9c3a0", estado, true);

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
          /* El punto de arranque también es parte del recorrido: si no entra al
             track, el primer tramo nunca llega a dibujarse. */
          estado.pos = p;
          estado.track.push(p);
          ultimaFijacion = Date.now();
          guardar();
          dibujarMapa();
          return;
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
  var avisoTimer = null;

  function yaPendiente(tipo, k) {
    return estado.pendientes.some(function (p) { return p.tipo === tipo && p.km === k; });
  }

  function encolar(tipo, k) {
    if (yaPendiente(tipo, k)) return false;
    /* Se anota dónde estaba al cruzarla: la foto de la parada se dibuja ahí y
       no en donde esté el auto cuando se saca. */
    estado.pendientes.push({
      tipo: tipo, km: k,
      lat: estado.pos ? estado.pos.lat : null,
      lon: estado.pos ? estado.pos.lon : null
    });
    return true;
  }

  function agregarUna(lista, v) { if (lista.indexOf(v) === -1) lista.push(v); }

  function eventoDe(tipo, k) {
    var lista = tipo === "pista" ? CFG.hitos : CFG.destinos;
    for (var i = 0; i < lista.length; i++) if (lista[i].km === k) return lista[i];
    return null;
  }

  function visto(tipo, k) {
    return (tipo === "pista" ? estado.vistas : estado.destinosVistos).indexOf(k) !== -1;
  }

  function marcarVisto(ev) {
    if (!ev) return;
    agregarUna(ev.tipo === "pista" ? estado.vistas : estado.destinosVistos, ev.km);
  }

  function todoVisto() {
    return CFG.hitos.every(function (h) { return estado.vistas.indexOf(h.km) !== -1; }) &&
      CFG.destinos.every(function (d) { return estado.destinosVistos.indexOf(d.km) !== -1; });
  }

  function revisarEventos() {
    var algo = false;

    CFG.hitos.forEach(function (h) {
      if (!visto("pista", h.km) && estado.km >= h.km * 1000) {
        if (encolar("pista", h.km)) algo = true;
      }
    });

    CFG.destinos.forEach(function (d) {
      if (!visto("destino", d.km) && estado.km >= d.km * 1000) {
        if (encolar("destino", d.km)) algo = true;
      }
    });

    if (algo) { guardar(); siguienteEvento(); }
    actualizarBotonTerminar();
  }

  function siguienteEvento() {
    if (modalAbierto || estado.pendientes.length === 0) return;
    if (document.hidden) return;
    abrirEvento(estado.pendientes[0]);
  }

  function abrirEvento(ev) {
    if (!ev) return;
    var def = eventoDe(ev.tipo, ev.km);
    /* La parada quedó en la cola pero ya no existe en el config (se borró):
       se saca de la cola en vez de romper la app con un error. */
    if (!def) {
      estado.pendientes = estado.pendientes.filter(function (p) {
        return !(p.tipo === ev.tipo && p.km === ev.km);
      });
      siguienteEvento();
      return;
    }
    var esPista = ev.tipo === "pista";
    var conFoto = esPista ? !!def.foto : true;

    modalAbierto = true;
    contextoFoto = ev;
    eventoActual = ev;
    $("#m-sello").textContent = esPista ? "🎁 PISTA" : "🎉 DESTINO";
    $("#m-sello").classList.toggle("oculto", !esPista);
    $("#m-titulo").textContent = def.titulo || "";
    $("#m-texto").textContent = def.mensaje || "";
    $("#m-subir-foto").classList.toggle("oculto", !conFoto);
    var inp = $("#m-input");
    var conInput = esPista && !!def.input;
    inp.classList.toggle("oculto", !conInput);
    if (conInput) {
      inp.value = estado.respuestas[ev.km] || "";
      inp.placeholder = def.placeholder || "";
    }
    $("#modal-evento").classList.add("abierto");
    limpiarAviso();
  }

  /* ======================== FOTOS ========================
     Cada foto guarda a qué recorrido y a qué parada pertenece. Eso permite
     varias fotos por parada, agruparlas después para dibujar un solo marcador
     con contador, y que un recorrido terminado conserve los suyos cuando se
     empiece uno nuevo. Las fotos de las versiones viejas guardaban el número de
     posición que tenía la parada en la lista de ese momento: con las firmas de
     cada versión se recupera su km, y las que no se pueden recuperar quedan como
     fotos sueltas. */
  function fotoEsDe(f, id) {
    /* Las que no tienen recorrido son del que esté en curso: las más viejas
       todavía no existían los recorridos guardados. */
    if (f.recorrido == null) return id === estado.id;
    return f.recorrido === id;
  }

  function fotosDeRecorrido(id, cb) {
    todasFotos(function (todas) {
      cb(todas.filter(function (f) { return fotoEsDe(f, id); }));
    });
  }

  function kmDeFoto(f) {
    if (f.kmEv != null) return f.kmEv;
    if (f.idx == null) return null;
    var esPista = f.tipo === "pista";
    var cfg = esPista ? CFG.hitos : CFG.destinos;
    /* El mismo índice puede significar dos paradas distintas según la versión
       que guardó la foto: se elige la que este recorrido ya registró, y si no
       registró ninguna, la de la versión más vieja. */
    var marcadas = esPista ? estado.vistas.concat(estado.hitoFotos) : estado.destinosVistos.concat(estado.destinoFotos);
    var candidatas = [FIRMA_VIEJA[esPista ? "hitos" : "destinos"], FIRMA_KM[esPista ? "hitos" : "destinos"]];
    for (var c = 0; c < candidatas.length; c++) {
      var k = candidatas[c][f.idx];
      if (k == null || marcadas.indexOf(k) === -1 || !existeEn(cfg, k)) continue;
      return k;
    }
    for (var c2 = 0; c2 < candidatas.length; c2++) {
      var k2 = candidatas[c2][f.idx];
      if (k2 != null && existeEn(cfg, k2)) return k2;
    }
    return null;
  }

  /* Aviso del modal: no cuenta fotos, solo avisa si una se guardó o si no se
     pudo leer. Los errores se quedan hasta el próximo intento. */
  function avisarFoto(texto, temporal) {
    var cont = $("#m-aviso");
    if (!cont) return;
    if (avisoTimer) { clearTimeout(avisoTimer); avisoTimer = null; }
    cont.textContent = texto || "";
    cont.classList.toggle("oculto", !texto);
    if (texto && temporal) {
      avisoTimer = setTimeout(limpiarAviso, 2500);
    }
  }

  function limpiarAviso() {
    if (avisoTimer) { clearTimeout(avisoTimer); avisoTimer = null; }
    avisarFoto("");
  }

  function cerrarEvento() {
    var ev = eventoActual;
    if (ev && ev.tipo === "pista" && !$("#m-input").classList.contains("oculto")) {
      var v = $("#m-input").value.trim();
      if (v) estado.respuestas[ev.km] = v;
    }
    /* El evento recién se da por visto cuando se cierra: si la app se suspende
       con el modal abierto, sigue en la cola y reaparece al volver. */
    for (var i = estado.pendientes.length - 1; i >= 0; i--) {
      var p = estado.pendientes[i];
      if (ev && p.tipo === ev.tipo && p.km === ev.km) {
        estado.pendientes.splice(i, 1);
      }
    }
    marcarVisto(ev);
    modalAbierto = false;
    contextoFoto = null;
    eventoActual = null;
    $("#modal-evento").classList.remove("abierto");
    guardar();

    /* Cerrar la parada no termina nada: el recorrido lo termina ella cuando quiera
       apretando el botón. Así puede subir todos los recuerdos que quiera en la
       última parada sin que ninguna foto se cierre el viaje. */
    if (document.hidden) return;
    siguienteEvento();
    actualizarBotonTerminar();
  }

  function actualizarBotonTerminar() {
    $("#btn-terminar").classList.toggle("oculto", !(todoVisto() && !estado.finalizado));
  }

  /* ======================== FOTOS ======================== */
  var fotoAbriendo = false;
  var fotoEvento = null;   /* parada de la foto que se está sacando */

  function pedirFoto() {
    /* Un toque doble abriría dos selectores de archivo. Si el usuario
       cancela no se dispara ningún evento, así que el bloqueo se suelta solo. */
    if (fotoAbriendo) return;
    fotoAbriendo = true;
    setTimeout(function () { fotoAbriendo = false; }, 1000);
    /* La parada se anota ya: leer el archivo y achicar la imagen tarda, y para
       entonces el modal puede haberse cerrado (incluso solo, por un reinicio
       del sistema). Sin esto la foto queda sin parada, no cuenta para el
       recorrido y el viaje no se puede terminar. */
    fotoEvento = contextoFoto;
    var input = $("#input-foto");
    input.value = "";
    input.click();
  }

  function procesarArchivo(file) {
    fotoAbriendo = false;
    var ev = fotoEvento;
    fotoEvento = null;
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var dataUrl = null;
        try { dataUrl = achicar(img); }
        catch (err) { console.error("No se pudo procesar la foto:", err); }
        if (!dataUrl) { avisarFoto("No pude leer esa foto 😞 Probá otra."); return; }
        guardarFotoRegistrada(ev, dataUrl);
      };
      img.onerror = function () { avisarFoto("No pude leer esa foto 😞 Probá otra."); };
      img.src = e.target.result;
    };
    reader.onerror = function () { avisarFoto("No pude leer esa foto 😞 Probá otra."); };
    reader.readAsDataURL(file);
  }

  /* Se achica antes de guardar: una foto de cámara pesa megabytes y la base
     del navegador es finita. */
  function achicar(img) {
    var max = 1000;
    var escala = Math.min(1, max / Math.max(img.width, img.height));
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.width * escala));
    cv.height = Math.max(1, Math.round(img.height * escala));
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
    var dataUrl = cv.toDataURL("image/jpeg", 0.8);
    return (dataUrl.indexOf("data:image/jpeg") === 0 && dataUrl.length > 200) ? dataUrl : null;
  }

  function guardarFotoRegistrada(ev, dataUrl) {
    /* El lugar de la foto es donde estaba el auto al llegar a la parada, no
       donde esté cuando se saca: si tardaron en sacar el celular, igual queda
       en el lugar correcto. */
    var pos = (ev && ev.lat != null && ev.lon != null) ? { lat: ev.lat, lon: ev.lon } : estado.pos;
    if (!pos && estado.track.length) pos = estado.track[estado.track.length - 1];

    var foto = {
      fecha: new Date().toISOString(),
      recorrido: estado.id,
      km: ev ? ev.km * 1000 : estado.km,
      lat: pos ? pos.lat : null,
      lon: pos ? pos.lon : null,
      tipo: ev ? ev.tipo : null,
      kmEv: ev ? ev.km : null,
      dataUrl: dataUrl
    };

    guardarFoto(foto, function (ok) {
      if (!ok) {
        avisarFoto("No pude guardar el recuerdo 😞 Probá otra.");
        return;
      }
      if (ev) agregarUna(ev.tipo === "pista" ? estado.hitoFotos : estado.destinoFotos, ev.km);
      guardar();
      avisarFoto("¡Recuerdo guardado! 📸", true);
      /* El modal sigue abierto: se pueden subir varias fotos de la misma parada. */
      renderRecuerdos(estado.id);
    });
  }

  function renderRecuerdos(id) {
    fotosDeRecorrido(id || estado.id, function (fotos) {
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

  /* Las fotos se agrupan por parada para que las varias de una misma parada se
     dibujen en un solo marcador con contador. Las fotos que no se pudieron
     ubicar en ninguna parada quedan cada una en su propio grupo. */
  function agruparFotos(fotos) {
    var grupos = [], porClave = {}, sueltos = 0;
    fotos.forEach(function (f) {
      var k = kmDeFoto(f);
      var clave = (f.tipo && k != null)
        ? f.tipo + ":" + k
        : "suelta:" + (f.id != null ? f.id : "x" + sueltos++);
      if (!porClave[clave]) {
        porClave[clave] = [];
        grupos.push(porClave[clave]);
      }
      porClave[clave].push(f);
    });
    return grupos;
  }

  /* ======================== FINAL ======================== */
  var mapaFinal = null;
  var grupoFinal = null;
  var renderFinalToken = 0;
  var encajadoFinal = false;
  var vistaFinal = null;   /* recorrido que se está mostrando en esta pantalla */

  function finalizar() {
    if (estado.finalizado) return;
    estado.finalizado = true;
    wakePedido = false;
    soltarWake();
    guardar();
    archivar();
    if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
    abrirRecorrido(estado, true);
  }

  /* La misma pantalla sirve para el recorrido que acaba de terminar y para
     cualquiera de los guardados: solo cambia de dónde saca el mapa y las fotos. */
  function abrirRecorrido(t, esActual) {
    vistaFinal = t;
    /* Cada recorrido se encuadra por separado: si no, el segundo mostraría el
       mapa encuadrado sobre el recorrido anterior. */
    encajadoFinal = false;
    $("#f-mensaje").textContent = esActual
      ? (CFG.textoFinal || "")
      : textoRecorrido(t);
    $("#btn-reiniciar").classList.toggle("oculto", !esActual);
    $("#btn-volver").classList.toggle("oculto", !!esActual);
    mostrarPantalla("pantalla-final");
    actualizarBotonesRecorridos();
    renderRecuerdos(t.id);
    cargarLeaflet(dibujarMapaFinal);
  }

  function textoRecorrido(t) {
    return (CFG.textoRecorrido || "Recorrido del {fecha} · {km} km")
      .replace("{fecha}", fechaLegible(t.cerrado))
      .replace("{km}", formatearKm(t.km));
  }

  function fechaLegible(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return ""; }
  }

  function dibujarMapaFinal() {
    if (!window.L) { cargarLeaflet(dibujarMapaFinal); return; }
    $("#mapa-final-wrap").classList.remove("oculto");
    if (mapaFinal) { renderFinal(); return; }
    var pos = (vistaFinal && vistaFinal.pos) || estado.pos || { lat: -34.6, lon: -58.4 };
    mapaFinal = window.L.map("mapa-final").setView([pos.lat, pos.lon], 10);
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
    var t = vistaFinal || estado;
    var token = ++renderFinalToken;
    grupoFinal.clearLayers();

    /* Solo el recorrido en curso puede tener huecos sin resolver: a uno ya
       terminado no se le piden rutas nuevas. */
    pintarRecorrido(grupoFinal, "#e8a0b4", t, t === estado);

    var bounds = [];
    t.track.forEach(function (p) { bounds.push([p.lat, p.lon]); });
    if (t.pos) bounds.push([t.pos.lat, t.pos.lon]);

    fotosDeRecorrido(t.id, function (fotos) {
      if (token !== renderFinalToken) return;
      agruparFotos(fotos).forEach(function (g) {
        /* Varias fotos pueden caer en el mismo instante si el GPS titila: se
           dibuja la primera que sí tenga posición. */
        var conPos = g.filter(function (f) { return f.lat !== null && f.lon !== null; });
        if (!conPos.length) return;
        var html = '<img src="' + conPos[0].dataUrl + '">' +
          (g.length > 1 ? '<span class="foto-n">' + g.length + "</span>" : "");
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
        /* El mapa puede seguir sin tamaño cuando se muestra la pantalla final.
           Encajar antes de que mida bien encuadra cualquier cosa, y como el
           encuadre se hace una sola vez, después ya no se corrige. */
        mapaFinal.invalidateSize();
        mapaFinal.fitBounds(bounds, { padding: [40, 40] });
        encajadoFinal = true;
      }
    });

    setTimeout(function () { if (mapaFinal) mapaFinal.invalidateSize(); }, 150);
  }

  /* ======================== HISTORIAL ======================== */
  function abrirHistorial() {
    mostrarPantalla("pantalla-historial");
    renderHistorial();
  }

  function volver() {
    if (estado.finalizado) { mostrarPantalla("pantalla-final"); return; }
    if (estado.iniciado) { mostrarPantalla("pantalla-viaje"); return; }
    mostrarPantalla("pantalla-portada");
  }

  function renderHistorial() {
    var lista = leerHistorial();
    var cont = $("#h-lista");
    cont.innerHTML = "";
    $("#h-vacio").classList.toggle("oculto", lista.length > 0);
    if (!lista.length) return;
    todasFotos(function (todas) {
      /* Una miniatura por recorrido: la primera foto que se le encontró. */
      var mini = {};
      todas.forEach(function (f) {
        if (f.recorrido != null && !mini[f.recorrido]) mini[f.recorrido] = f;
      });
      lista.forEach(function (t) { cont.appendChild(tarjetaRecorrido(t, mini[t.id])); });
    });
  }

  function tarjetaRecorrido(t, foto) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "h-card";
    /* Un recorrido sin fotos no muestra un marco vacío con la imagen rota. */
    var miniatura;
    if (foto) {
      miniatura = document.createElement("img");
      miniatura.className = "h-mini";
      miniatura.alt = "";
      miniatura.src = foto.dataUrl;
    } else {
      miniatura = document.createElement("div");
      miniatura.className = "h-mini vacio";
    }
    var datos = document.createElement("span");
    datos.className = "h-datos";
    var f1 = document.createElement("span");
    f1.className = "h-fecha";
    f1.textContent = fechaLegible(t.cerrado);
    var f2 = document.createElement("span");
    f2.className = "h-km";
    f2.textContent = formatearKm(t.km) + " km";
    datos.appendChild(f1);
    datos.appendChild(f2);
    b.appendChild(miniatura);
    b.appendChild(datos);
    b.addEventListener("click", function () { abrirRecorrido(t, false); });
    return b;
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
    actualizarBotonesRecorridos();
    cargarLeaflet();
    iniciarGps();
    renderRecuerdos(estado.id);
    /* Si ya había kilómetros recorridos (la app quedó abierta y vuelve a
       empezar), las paradas que se pasaron sin abrirse saltan ahora. */
    siguienteEvento();
  }

  var confirmarCb = null;

  function pedirConfirmacion(texto, cb) {
    confirmarCb = cb;
    $("#c-texto").textContent = texto || "";
    $("#modal-confirm").classList.add("abierto");
  }

  function responderConfirmacion(ok) {
    var cb = confirmarCb;
    confirmarCb = null;
    $("#modal-confirm").classList.remove("abierto");
    if (cb) cb(ok);
  }

  function reiniciar() {
    pedirConfirmacion(CFG.textoConfirmReiniciar, function (ok) {
      if (!ok) return;
      var idViejo = estado.id;
      /* Un recorrido ya terminado quedó guardado con sus fotos al apretar
         "Terminar recorrido": se conserva todo. Si no llegó a guardarse (por
         ejemplo, si no había lugar), sus recuerdos se van con él, porque no
         pueden quedar colgados de un recorrido que ya no existe. */
      var conservar = estado.finalizado && enHistorial(idViejo);
      estado = estadoInicial();
      guardar();
      try { localStorage.removeItem(LS_CLAVE_VIEJA); } catch (e) {}
      if (mapaFinal) { try { mapaFinal.remove(); } catch (e) {} }
      mapaFinal = null;
      grupoFinal = null;
      vistaFinal = null;
      var recargado = false;
      function recargar() {
        if (recargado) return;
        recargado = true;
        location.reload();
      }
      if (conservar) { recargar(); return; }
      borrarFotosDelRecorrido(idViejo, recargar);
      setTimeout(recargar, 800);
    });
  }

  /* Atajo de prueba: tocar 5 veces la intro abre el próximo evento */
  function probarEvento() {
    if (modalAbierto) return;
    var ev = null;
    CFG.hitos.some(function (h) {
      if (ev || estado.vistas.indexOf(h.km) !== -1) return false;
      ev = { tipo: "pista", km: h.km };
      return true;
    });
    if (!ev) {
      CFG.destinos.some(function (d) {
        if (ev || estado.destinosVistos.indexOf(d.km) !== -1) return false;
        ev = { tipo: "destino", km: d.km };
        return true;
      });
    }
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

    $$(".js-recorridos").forEach(function (b) {
      b.addEventListener("click", abrirHistorial);
    });
    $("#h-volver").addEventListener("click", volver);
    $("#btn-volver").addEventListener("click", abrirHistorial);
    $("#c-si").addEventListener("click", function () { responderConfirmacion(true); });
    $("#c-no").addEventListener("click", function () { responderConfirmacion(false); });

    $("#btn-reintentar").addEventListener("click", function () {
      if (watcher !== null) { navigator.geolocation.clearWatch(watcher); watcher = null; }
      ocultarErrorGps();
      iniciarGps();
    });

    $("#m-subir-foto").addEventListener("click", pedirFoto);
    $("#m-cerrar").addEventListener("click", cerrarEvento);
    /* En el celular el teclado tapa el botón de abajo: con Enter se cierra. */
    $("#m-input").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); cerrarEvento(); }
    });
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
    actualizarBotonTerminar();
  });
  window.addEventListener("pagehide", guardar);

  /* ======================== INIT ======================== */
  function init() {
    aplicarTextos();
    bindear();
    pintarWake();
    actualizarBotonesRecorridos();
    if (estado.finalizado) {
      abrirRecorrido(estado, true);
      return;
    }
    if (estado.iniciado && estado.pos) {
      mostrarPantalla("pantalla-viaje");
      renderKm();
      cargarLeaflet();
      iniciarGps();
      renderRecuerdos(estado.id);
      /* Eventos que quedaron a medio ver antes de que la app se suspendiera,
         y paradas nuevas que se pasaron sin abrirse. */
      revisarEventos();
      siguienteEvento();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();