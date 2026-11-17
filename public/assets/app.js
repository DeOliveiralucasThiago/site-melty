/* Loja Melty - vitrine, carrinho e páginas. Sem dependências. */
(function () {
  "use strict";

  var brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function reduzMovimento() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function achar(lista, id) { return lista.filter(function (x) { return x.id === id; })[0]; }

  /* ---------- carrinho (localStorage, com fallback em memória) ---------- */
  var memoria = {};
  function lerCarrinho() {
    try { return JSON.parse(localStorage.getItem("melty_carrinho") || "{}"); }
    catch (e) { return memoria; }
  }
  function salvarCarrinho(c) {
    memoria = c;
    try { localStorage.setItem("melty_carrinho", JSON.stringify(c)); } catch (e) { /* ignora */ }
  }
  function totalItens(c) {
    return Object.keys(c).reduce(function (n, k) { return n + c[k]; }, 0);
  }

  /* ---------- dados ---------- */
  var SEM_FOTO = "/assets/placeholder.svg";
  function foto(p) { return p.imagem || SEM_FOTO; }
  function carregar() {
    return fetch("/api/catalogo").then(function (r) {
      if (!r.ok) throw new Error("catalogo");
      return r.json();
    });
  }

  /* ---------- ícones ---------- */
  var ICONES = {
    mao: '<path d="M12 21s-7-4.4-9.3-9A5.2 5.2 0 0 1 12 6.5 5.2 5.2 0 0 1 21.3 12C19 16.6 12 21 12 21z"/>',
    cartao: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
    caixa: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    zap: '<path d="M21 12a8 8 0 0 1-11.7 7L4 20l1.1-4.2A8 8 0 1 1 21 12z"/>'
  };
  function svg(nome) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONES[nome] || ICONES.mao) + "</svg>"; }

  /* ---------- layout comum ---------- */
  function montarLayout(d) {
    var c = d.config;
    var avisos = (c.faixa_avisos || []).map(function (t, i) { return '<span' + (i === 0 ? ' class="on"' : "") + ">" + esc(t) + "</span>"; }).join("");
    var logo = c.logo
      ? '<img src="' + esc(c.logo) + '" alt="' + esc(c.loja) + '">'
      : "<b>" + esc(String(c.loja).toUpperCase()) + "</b><small>velas aromáticas</small>";
    var itens = '<a href="index.html">Início</a>' +
      d.categorias.filter(function (k) { return d.produtos.some(function (p) { return p.categoria === k.id; }); })
        .map(function (k) { return '<a href="catalogo.html?cat=' + encodeURIComponent(k.id) + '">' + esc(k.nome) + "</a>"; }).join("") +
      '<a href="index.html#quem-somos">Quem somos</a><a href="prazos.html">Prazos e Envio</a>' +
      '<a href="https://wa.me/' + esc(c.whatsapp) + '" rel="noopener">Contato</a>';

    document.getElementById("topo").innerHTML =
      (avisos ? '<div class="announce" aria-live="polite">' + avisos + "</div>" : "") +
      '<div class="head-row"><div class="head-left"><button class="menu-btn" id="menuBtn" aria-label="Abrir menu" aria-expanded="false"><svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div>' +
      '<a class="logo" href="index.html">' + logo + "</a>" +
      '<div class="head-right"><a class="cart-link" href="carrinho.html" aria-label="Carrinho"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg><span class="badge" id="badge">' + totalItens(lerCarrinho()) + "</span></a></div></div>" +
      '<nav class="main" id="menu" aria-label="Menu principal">' + itens + "</nav>";

    document.getElementById("menuBtn").onclick = function () {
      var m = document.getElementById("menu"), aberto = m.classList.toggle("open");
      this.setAttribute("aria-expanded", aberto ? "true" : "false");
    };

    var msgs = document.querySelectorAll(".announce span");
    if (msgs.length > 1 && !reduzMovimento()) {
      var k = 0;
      setInterval(function () {
        msgs[k].classList.remove("on"); k = (k + 1) % msgs.length; msgs[k].classList.add("on");
      }, 4000);
    }

    document.getElementById("rodape").innerHTML =
      '<div class="wrap"><div class="cols">' +
      "<div><h4>" + esc(c.loja) + "</h4><p>" + esc(c.slogan) + ".</p></div>" +
      '<div><h4>Institucional</h4><a href="index.html#quem-somos">Quem somos</a><a href="prazos.html">Prazos e Envio</a><a href="politica-de-privacidade.html">Política de Privacidade</a></div>' +
      '<div><h4>Atendimento</h4><a href="https://wa.me/' + esc(c.whatsapp) + '" rel="noopener">WhatsApp</a>' +
      '<a href="https://instagram.com/' + esc(c.instagram) + '" rel="noopener">Instagram @' + esc(c.instagram) + "</a>" +
      '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a></div></div>" +
      '<div class="copy">© ' + new Date().getFullYear() + " " + esc(c.loja) + " · Velas aromáticas artesanais</div></div>";
  }
  function atualizarBadge() {
    var b = document.getElementById("badge");
    if (b) b.textContent = totalItens(lerCarrinho());
  }
  function avisoPrazo(config) {
    return '<div class="notice"><strong>Prazo de entrega:</strong> ' + esc(config.aviso_prazo) + "</div>";
  }

  /* ---------- banner / carrossel ---------- */
  function htmlBanner(banners) {
    if (!banners || !banners.length) return "";
    var slides = banners.map(function (b, i) {
      var img = '<img src="' + esc(b.imagem) + '" alt="' + esc(b.alt || "") + '"' + (i ? ' loading="lazy"' : "") + ">";
      var over = "";
      if (b.titulo) {
        over = '<div class="over"><h2>' + esc(b.titulo) + "</h2>" + (b.botao ? '<span class="pill">' + esc(b.botao) + "</span>" : "") + "</div>";
      }
      return (b.link ? '<a class="slide" href="' + esc(b.link) + '">' : '<div class="slide">') + img + over + (b.link ? "</a>" : "</div>");
    }).join("");
    var controles = "";
    if (banners.length > 1) {
      controles = '<button class="nav prev" aria-label="Banner anterior">‹</button><button class="nav next" aria-label="Próximo banner">›</button><div class="dots">' +
        banners.map(function (_, i) { return '<button aria-label="Ir para o banner ' + (i + 1) + '"></button>'; }).join("") + "</div>";
    }
    return '<section class="banner" aria-roledescription="carrossel" aria-label="Destaques"><div class="track">' + slides + "</div>" + controles + "</section>";
  }

  function iniciarCarrossel(n) {
    var el = document.querySelector(".banner");
    if (!el || n < 2) return;
    var track = el.querySelector(".track"), dots = el.querySelectorAll(".dots button");
    var i = 0, timer = null;
    function ir(k) {
      i = (k + n) % n;
      track.style.transform = "translateX(-" + (i * 100) + "%)";
      dots.forEach(function (b, j) { b.setAttribute("aria-current", j === i ? "true" : "false"); });
    }
    function parar() { if (timer) { clearInterval(timer); timer = null; } }
    function iniciar() {
      parar();
      if (reduzMovimento()) return;
      timer = setInterval(function () { ir(i + 1); }, 5000);
    }
    el.querySelector(".prev").onclick = function () { ir(i - 1); iniciar(); };
    el.querySelector(".next").onclick = function () { ir(i + 1); iniciar(); };
    dots.forEach(function (b, j) { b.onclick = function () { ir(j); iniciar(); }; });
    el.addEventListener("mouseenter", parar);
    el.addEventListener("mouseleave", iniciar);
    var x0 = null;
    el.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; parar(); }, { passive: true });
    el.addEventListener("touchend", function (e) {
      if (x0 !== null) { var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) ir(i + (dx < 0 ? 1 : -1)); }
      x0 = null; iniciar();
    });
    ir(0); iniciar();
  }

  /* ---------- vitrine ---------- */
  function cardProduto(p) {
    var tag = "", esgotado = p.estoque <= 0;
    if (esgotado) tag = '<span class="tag">Esgotado</span>';
    else if (p.estoque === 1) tag = '<span class="tag low">Última unidade</span>';
    if (p.promocao && !esgotado) tag += '<span class="tag promo">Promoção</span>';
    return '<a class="card" href="produto.html?id=' + encodeURIComponent(p.id) + '">' +
      '<div class="img"><img src="' + esc(foto(p)) + '" alt="' + esc(p.nome) + '" loading="lazy">' + tag + "</div>" +
      '<div class="info"><h3>' + esc(p.nome) + '</h3>' + htmlPreco(p) +
      '<span class="pill' + (esgotado ? " off" : "") + '">' + (esgotado ? "Esgotado" : "Ver vela") + "</span></div></a>";
  }
  function htmlPreco(p) {
    if (!p.promocao) return '<span class="price">' + brl.format(p.preco) + "</span>";
    var pct = Math.round((1 - p.preco / p.preco_cheio) * 100);
    return '<span class="price"><s class="de">' + brl.format(p.preco_cheio) + "</s>" + brl.format(p.preco) + ' <span class="off">-' + pct + "%</span></span>";
  }
  function disponiveisPrimeiro(lista) {
    return lista.filter(function (p) { return p.estoque > 0; }).concat(lista.filter(function (p) { return p.estoque <= 0; }));
  }
  function secao(titulo, sub, lista) {
    if (!lista.length) return "";
    return '<section class="sec wrap"><div class="sec-head"><h2>' + esc(titulo) + "</h2>" + (sub ? "<p>" + esc(sub) + "</p>" : "") +
      '</div><div class="grid">' + disponiveisPrimeiro(lista).map(cardProduto).join("") + "</div></section>";
  }

  function htmlBeneficios(lista) {
    if (!lista || !lista.length) return "";
    return '<div class="wrap"><div class="benef">' + lista.map(function (b) {
      return "<div>" + svg(b.icone) + "<div><strong>" + esc(b.titulo) + "</strong><span>" + esc(b.texto) + "</span></div></div>";
    }).join("") + "</div></div>";
  }

  function paginaHome(d) {
    var c = d.config, qs = c.quem_somos, dep = c.depoimentos || [];
    var html = htmlBanner(d.banners) + htmlBeneficios(c.beneficios) +
      secao("Novidades", "acabou de chegar", d.produtos.filter(function (p) { return p.novidade; })) +
      secao("Mais vendidas", "as queridinhas", d.produtos.filter(function (p) { return p.destaque; })) +
      secao("Nossas velas", "feitas com carinho", d.produtos);
    html += '<div class="wrap">' + avisoPrazo(c) + "</div>";
    if (qs) {
      html += '<section class="about" id="quem-somos"><div class="wrap"><img src="' + esc(qs.imagem || SEM_FOTO) + '" alt="" loading="lazy"><div><h2>' + esc(qs.titulo) + "</h2>" +
        (qs.textos || []).map(function (t) { return "<p>" + esc(t) + "</p>"; }).join("") + "</div></div></section>";
    }
    if (dep.length) {
      html += '<section class="sec wrap"><div class="sec-head"><h2>Depoimentos</h2><p>quem já conhece, ama</p></div><div class="reviews">' +
        dep.map(function (r) { return '<div class="review"><div class="stars">★★★★★</div><p>' + esc(r.texto) + "</p><b>" + esc(r.nome) + "</b></div>"; }).join("") + "</div></section>";
    }
    html += '<section class="contact"><h2>Fale com a gente</h2><p>Dúvidas, encomendas especiais ou presentes? Ficamos felizes em ajudar.</p>' +
      '<a class="btn light" href="https://wa.me/' + esc(c.whatsapp) + '" rel="noopener">Chamar no WhatsApp</a>' +
      '<a class="btn ghost" href="https://instagram.com/' + esc(c.instagram) + '" rel="noopener">Ver o Instagram</a></section>';
    document.getElementById("app").innerHTML = html;
    iniciarCarrossel((d.banners || []).length);
  }

  function paginaCatalogo(d) {
    var cat = new URLSearchParams(location.search).get("cat");
    var k = cat ? achar(d.categorias, cat) : null;
    var lista = cat ? d.produtos.filter(function (p) { return p.categoria === cat; }) : d.produtos;
    var titulo = k ? k.nome : "Todos os produtos";
    document.title = titulo + " | " + d.config.loja;
    var corpo = lista.length ? secao(titulo, k && k.descricao ? k.descricao : "", lista)
      : '<div class="wrap page"><h1>' + esc(titulo) + "</h1><p>Nenhum produto por aqui ainda.</p></div>";
    document.getElementById("app").innerHTML = corpo + '<div class="wrap">' + avisoPrazo(d.config) + "</div>";
  }

  /* ---------- produto ---------- */
  function miniaturas(p) {
    if (!p.imagens || p.imagens.length < 2) return "";
    return '<div class="thumbs">' + p.imagens.map(function (u, i) {
      return '<button type="button" data-src="' + esc(u) + '" aria-label="Ver foto ' + (i + 1) + '"><img src="' + esc(u) + '" alt=""></button>';
    }).join("") + "</div>";
  }
  function paginaProduto(d) {
    var id = new URLSearchParams(location.search).get("id");
    var p = achar(d.produtos, id);
    var app = document.getElementById("app");
    if (!p) {
      app.innerHTML = '<div class="wrap page"><h1>Produto não encontrado</h1><p><a href="index.html">Voltar para a loja</a></p></div>';
      return;
    }
    document.title = p.nome + " | " + d.config.loja;
    var k = achar(d.categorias, p.categoria);
    var esgotado = p.estoque <= 0;
    var estoqueTxt = esgotado ? "Esgotado" : (p.estoque === 1 ? "Última unidade disponível" : p.estoque + " unidades disponíveis");
    app.innerHTML =
      '<div class="wrap"><div class="product">' +
      '<div><img id="fotoPrincipal" src="' + esc(foto(p)) + '" alt="' + esc(p.nome) + '">' + miniaturas(p) + "</div>" +
      '<div><p class="crumbs"><a href="index.html">Início</a> / ' +
      (k ? '<a href="catalogo.html?cat=' + encodeURIComponent(k.id) + '">' + esc(k.nome) + "</a> / " : "") + esc(p.nome) + "</p>" +
      "<h1>" + esc(p.nome) + "</h1><div class=\"price grande\">" + htmlPreco(p).replace(/^<span class="price">|<\/span>$/g, "") + "</div>" +
      '<p class="small muted">' + estoqueTxt + "</p>" +
      '<div class="desc">' + p.descricao + "</div>" +
      '<div class="qty"><button id="menos" aria-label="Diminuir">−</button><span id="q">1</span><button id="mais" aria-label="Aumentar">+</button></div>' +
      '<button class="btn" id="add"' + (esgotado ? " disabled" : "") + ">" + (esgotado ? "Esgotado" : "Adicionar ao carrinho") + "</button>" +
      '<p id="msg" class="small" role="status"></p>' +
      avisoPrazo(d.config) +
      "</div></div></div>";
    app.querySelectorAll(".thumbs button").forEach(function (b) {
      b.onclick = function () { document.getElementById("fotoPrincipal").src = b.getAttribute("data-src"); };
    });
    var q = 1;
    var qEl = document.getElementById("q");
    document.getElementById("menos").onclick = function () { q = Math.max(1, q - 1); qEl.textContent = q; };
    document.getElementById("mais").onclick = function () { q = Math.min(Math.max(p.estoque, 1), q + 1); qEl.textContent = q; };
    document.getElementById("add").onclick = function () {
      if (esgotado) return;
      var c = lerCarrinho();
      c[p.id] = Math.min(p.estoque, (c[p.id] || 0) + q);
      salvarCarrinho(c);
      atualizarBadge();
      document.getElementById("msg").innerHTML = 'Adicionado! <a href="carrinho.html">Ver carrinho</a>';
    };
  }

  /* ---------- carrinho ---------- */
  function paginaCarrinho(d) {
    var app = document.getElementById("app");
    function desenhar() {
      var c = lerCarrinho();
      var linhas = [], subtotal = 0, ajustou = false;
      Object.keys(c).forEach(function (id) {
        var p = achar(d.produtos, id);
        if (!p || p.estoque <= 0) { delete c[id]; ajustou = true; return; }
        if (c[id] > p.estoque) { c[id] = p.estoque; ajustou = true; }
        subtotal += p.preco * c[id];
        linhas.push({ p: p, n: c[id] });
      });
      if (ajustou) { salvarCarrinho(c); atualizarBadge(); }

      if (!linhas.length) {
        app.innerHTML = '<div class="wrap page"><h1>Seu carrinho</h1><p>O carrinho está vazio.</p><a class="btn" href="index.html">Ver velas</a></div>';
        return;
      }
      var itens = linhas.map(function (l) {
        return '<div class="cart-row"><img src="' + esc(foto(l.p)) + '" alt="">' +
          "<div><strong>" + esc(l.p.nome) + "</strong><br><span class='muted small'>" + brl.format(l.p.preco) + " cada</span>" +
          '<div class="qty"><button data-a="menos" data-id="' + esc(l.p.id) + '">−</button><span>' + l.n +
          '</span><button data-a="mais" data-id="' + esc(l.p.id) + '">+</button></div></div>' +
          '<div style="text-align:right"><div class="price">' + brl.format(l.p.preco * l.n) + "</div>" +
          '<button class="rm" data-a="rm" data-id="' + esc(l.p.id) + '">Remover</button></div></div>';
      }).join("");

      var msg = "Olá! Gostaria de fazer um pedido:%0A" + linhas.map(function (l) {
        return encodeURIComponent("• " + l.n + "x " + l.p.nome + " (" + brl.format(l.p.preco) + ")");
      }).join("%0A") + "%0A" + encodeURIComponent("Subtotal: " + brl.format(subtotal));

      app.innerHTML =
        '<div class="wrap page"><h1>Seu carrinho</h1>' + itens +
        '<div class="summary"><div class="line"><span>Subtotal</span><span>' + brl.format(subtotal) + "</span></div>" +
        '<div class="line muted"><span>Frete</span><span>calculado no fechamento (em breve)</span></div>' +
        '<div class="line total"><span>Total</span><span>' + brl.format(subtotal) + "</span></div></div>" +
        avisoPrazo(d.config) +
        (d.config.pagamento_ativo
          ? '<p><a class="btn" href="checkout.html">Finalizar compra</a></p><p class="small muted">Você informa os dados de entrega e escolhe como pagar no próximo passo. O frete e os descontos são confirmados lá.</p>'
          : '<p><a class="btn" href="https://wa.me/' + esc(d.config.whatsapp) + "?text=" + msg + '" rel="noopener">Finalizar pelo WhatsApp (provisório)</a></p>' +
            '<p class="small muted">O pagamento online ainda não está ativo. Por enquanto o pedido é combinado pelo WhatsApp.</p>') + "</div>";

      app.querySelectorAll("button[data-a]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-id"), a = b.getAttribute("data-a");
          var cc = lerCarrinho();
          var p = achar(d.produtos, id);
          if (a === "rm") delete cc[id];
          if (a === "mais") cc[id] = Math.min(p.estoque, (cc[id] || 0) + 1);
          if (a === "menos") { cc[id] = (cc[id] || 1) - 1; if (cc[id] <= 0) delete cc[id]; }
          salvarCarrinho(cc); atualizarBadge(); desenhar();
        };
      });
    }
    desenhar();
  }


  /* ---------- fechamento da compra ---------- */
  function cpfValido(t) {
    var d = String(t).replace(/\D/g, "");
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    function dv(base) { var s = 0; for (var i = 0; i < base.length; i++) s += Number(base[i]) * (base.length + 1 - i); var r = (s * 10) % 11; return r === 10 ? 0 : r; }
    return dv(d.slice(0, 9)) === Number(d[9]) && dv(d.slice(0, 10)) === Number(d[10]);
  }
  function mascara(el, fn) { el.addEventListener("input", function () { el.value = fn(el.value.replace(/\D/g, "")); }); }
  var mCpf = function (d) { d = d.slice(0, 11); return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2"); };
  var mCep = function (d) { d = d.slice(0, 8); return d.replace(/^(\d{5})(\d)/, "$1-$2"); };
  var mTel = function (d) { d = d.slice(0, 11); return d.length > 10 ? d.replace(/^(\d{2})(\d{5})(\d)/, "($1) $2-$3") : d.replace(/^(\d{2})(\d{4})(\d)/, "($1) $2-$3"); };
  var UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","SC","TO"].filter(function (u, i, a) { return a.indexOf(u) === i; });

  function enviarJson(url, corpo) {
    return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (dados) { return { ok: r.ok, status: r.status, dados: dados }; }); });
  }
  function itensDoCarrinho() {
    var c = lerCarrinho();
    return Object.keys(c).map(function (id) { return { id: id, qtd: c[id] }; });
  }

  function paginaCheckout(d) {
    var app = document.getElementById("app");
    var itens = itensDoCarrinho();
    if (!itens.length) {
      app.innerHTML = '<div class="wrap page"><h1>Finalizar compra</h1><p>O carrinho está vazio.</p><a class="btn" href="index.html">Ver velas</a></div>';
      return;
    }
    if (!d.config.pagamento_ativo) {
      app.innerHTML = '<div class="wrap page"><h1>Finalizar compra</h1><p>O pagamento online ainda não está disponível. <a href="carrinho.html">Voltar ao carrinho</a> e finalizar pelo WhatsApp.</p></div>';
      return;
    }
    var estado = { cupom: "", resumo: null, frete_id: "", opcoes: null, producao: 0 };

    function campo(id, rotulo, extra) {
      return '<div class="campo"><label for="' + id + '">' + rotulo + '</label><input id="' + id + '" name="' + id + '" ' + (extra || "") + " required></div>";
    }
    app.innerHTML = '<div class="wrap page largo"><h1>Finalizar compra</h1><div class="checkout"><form id="form" novalidate>' +
      "<h2>Seus dados</h2>" +
      campo("nome", "Nome completo", 'autocomplete="name" maxlength="80"') +
      '<div class="dois">' + campo("email", "E-mail", 'type="email" autocomplete="email" maxlength="120"') + campo("email2", "Confirme o e-mail", 'type="email" autocomplete="off" maxlength="120"') + "</div>" +
      '<div class="dois">' + campo("telefone", "Telefone com DDD", 'type="tel" autocomplete="tel" inputmode="numeric" placeholder="(27) 99999-0000"') + campo("cpf", "CPF", 'inputmode="numeric" autocomplete="off" placeholder="000.000.000-00"') + "</div>" +
      '<p class="small muted">Usamos o CPF para emitir o pagamento e controlar cupons. Veja a <a href="politica-de-privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</p>' +
      "<h2>Endereço de entrega</h2>" +
      '<div class="dois">' + campo("cep", "CEP", 'inputmode="numeric" autocomplete="postal-code" placeholder="00000-000"') + campo("rua", "Rua", 'autocomplete="address-line1" maxlength="100"') + "</div>" +
      '<div class="tres">' + campo("numero", "Número", 'maxlength="10"') + '<div class="campo"><label for="complemento">Complemento</label><input id="complemento" maxlength="40" autocomplete="address-line2"></div>' + campo("bairro", "Bairro", 'maxlength="60"') + "</div>" +
      '<div class="dois">' + campo("cidade", "Cidade", 'maxlength="60" autocomplete="address-level2"') +
      '<div class="campo"><label for="uf">Estado</label><select id="uf" required><option value="">Selecione</option>' + UFS.map(function (u) { return "<option>" + u + "</option>"; }).join("") + "</select></div></div>" +
      '<h2>Forma de entrega</h2><div id="entrega"><p class="small muted">Informe o CEP para ver as opções de entrega.</p></div>' +
      "<h2>Cupom de desconto</h2>" +
      '<div class="cupom"><input id="cupom" maxlength="20" placeholder="Código do cupom" autocomplete="off"><button type="button" class="btn ghost" id="aplicar">Aplicar</button></div><p id="msgCupom" class="small" role="status"></p>' +
      '<label class="aceite"><input type="checkbox" id="aceite"> Li e concordo com a <a href="politica-de-privacidade.html" target="_blank" rel="noopener">Política de Privacidade</a>.</label>' +
      '<p id="erro" class="erro" role="alert"></p>' +
      '<button class="btn" id="enviar" type="submit">Ir para o pagamento</button></form>' +
      '<aside class="resumo" id="resumo"><p class="muted">Calculando…</p></aside></div></div>';

    var $ = function (id) { return document.getElementById(id); };
    mascara($("cpf"), mCpf); mascara($("cep"), mCep); mascara($("telefone"), mTel);
    $("cep").addEventListener("input", function () { clearTimeout(tCep); tCep = setTimeout(buscarFrete, 350); });

    function desenharResumo() {
      var r = estado.resumo; if (!r) return;
      $("resumo").innerHTML = "<h2>Resumo</h2>" + r.itens.map(function (i) {
        return '<div class="linha-res"><span>' + i.qtd + "× " + esc(i.nome) + (i.promocao ? ' <em class="promo-txt">promoção</em>' : "") + "</span><span>" + brl.format(i.subtotal) + "</span></div>";
      }).join("") +
        '<div class="linha-res"><span>Subtotal</span><span>' + brl.format(r.subtotal) + "</span></div>" +
        (r.desconto > 0 ? '<div class="linha-res desc"><span>Desconto (' + esc(r.cupom.codigo) + ")</span><span>− " + brl.format(r.desconto) + "</span></div>" : "") +
        '<div class="linha-res"><span>Frete' + (r.entrega ? " (" + esc(r.entrega) + ")" : "") + "</span><span>" + (r.frete === null ? "informe o CEP" : (r.frete > 0 ? brl.format(r.frete) : "Grátis")) + "</span></div>" +
        '<div class="linha-res total"><span>Total' + (r.frete === null ? " (sem frete)" : "") + "</span><span>" + brl.format(r.total) + "</span></div>" +
        '<p class="small muted">Valores conferidos pelo servidor no momento da compra.</p>' + avisoPrazo(d.config);
    }
    function simular(comCupom) {
      var corpo = { itens: itens };
      if (comCupom) { corpo.cupom = estado.cupom; corpo.cpf = $("cpf").value; }
      var cepD = $("cep").value.replace(/\D/g, "");
      if (cepD.length === 8 && (estado.frete_id || (estado.opcoes && estado.opcoes.length === 1))) { corpo.cep = cepD; corpo.frete_id = estado.frete_id; }
      return enviarJson("/api/cupom/simular", corpo);
    }
    function atualizarResumo() {
      return simular(!!estado.cupom).then(function (r) { if (r.ok) { estado.resumo = r.dados; desenharResumo(); } });
    }
    function textoPrazo(o) {
      var partes = [];
      if (estado.producao) partes.push("produção até " + estado.producao + " dias úteis");
      if (o.prazo_dias_uteis !== null && o.prazo_dias_uteis !== undefined) partes.push("transporte " + o.prazo_dias_uteis + " dia(s) útil(eis) após a postagem");
      return partes.join(" + ");
    }
    function desenharOpcoes() {
      var box = $("entrega");
      if (!estado.opcoes) return;
      if (!estado.opcoes.length) { box.innerHTML = '<p class="erro">Ainda não entregamos neste CEP. <a href="https://wa.me/' + esc(d.config.whatsapp) + '" rel="noopener">Fale com a gente pelo WhatsApp</a>.</p>'; return; }
      box.innerHTML = estado.opcoes.map(function (o) {
        return '<label class="opcao"><input type="radio" name="frete" value="' + esc(o.id) + '"' + (o.id === estado.frete_id ? " checked" : "") + "><span><b>" + esc(o.servico) + "</b> · " + (o.preco > 0 ? brl.format(o.preco) : "Grátis") +
          (textoPrazo(o) ? '<br><span class="small muted">' + esc(textoPrazo(o)) + "</span>" : "") + "</span></label>";
      }).join("");
      box.querySelectorAll("input[name=frete]").forEach(function (r) { r.onchange = function () { estado.frete_id = r.value; atualizarResumo(); }; });
    }
    var tCep = null;
    function buscarFrete() {
      var cepD = $("cep").value.replace(/\D/g, "");
      estado.opcoes = null; estado.frete_id = "";
      if (cepD.length !== 8) { $("entrega").innerHTML = '<p class="small muted">Informe o CEP para ver as opções de entrega.</p>'; atualizarResumo(); return; }
      $("entrega").innerHTML = '<p class="small muted">Calculando…</p>';
      enviarJson("/api/frete/cotar", { itens: itens, cep: cepD }).then(function (r) {
        if (!r.ok) { $("entrega").innerHTML = '<p class="erro">' + esc(r.dados.erro || "Não foi possível calcular a entrega.") + "</p>"; return; }
        estado.opcoes = r.dados.opcoes; estado.producao = r.dados.producao_dias;
        if (r.dados.uf) $("uf").value = r.dados.uf;
        if (estado.opcoes.length === 1) estado.frete_id = estado.opcoes[0].id;
        desenharOpcoes(); atualizarResumo();
      }).catch(function () { $("entrega").innerHTML = '<p class="erro">Sem conexão. Tente de novo.</p>'; });
    }
    simular(false).then(function (r) {
      if (!r.ok) { $("resumo").innerHTML = '<p class="erro">' + esc(r.dados.erro || "Não foi possível calcular.") + '</p><p><a href="carrinho.html">Voltar ao carrinho</a></p>'; $("enviar").disabled = true; return; }
      estado.resumo = r.dados; desenharResumo();
    });

    $("aplicar").onclick = function () {
      var cod = $("cupom").value.trim().toUpperCase(), msg = $("msgCupom");
      if (!cod) { estado.cupom = ""; simular(false).then(function (r) { if (r.ok) { estado.resumo = r.dados; desenharResumo(); } }); msg.textContent = ""; return; }
      if (!cpfValido($("cpf").value)) { msg.className = "small erro"; msg.textContent = "Preencha primeiro um CPF válido: o cupom é vinculado ao CPF."; $("cpf").focus(); return; }
      estado.cupom = cod;
      simular(true).then(function (r) {
        if (!r.ok) { estado.cupom = ""; msg.className = "small erro"; msg.textContent = r.dados.erro || "Cupom inválido."; return; }
        estado.resumo = r.dados; msg.className = "small ok"; msg.textContent = r.dados.frete_gratis ? "Cupom aplicado: frete grátis." : "Cupom aplicado!"; desenharResumo();
      });
    };

    $("form").onsubmit = function (ev) {
      ev.preventDefault();
      var erro = $("erro"); erro.textContent = "";
      function v(id) { return $(id).value.trim(); }
      var falta = ["nome", "email", "email2", "telefone", "cpf", "cep", "rua", "numero", "bairro", "cidade", "uf"].filter(function (id) { return !v(id); });
      if (falta.length) { erro.textContent = "Preencha todos os campos obrigatórios."; $(falta[0]).focus(); return; }
      if (v("email").toLowerCase() !== v("email2").toLowerCase()) { erro.textContent = "Os dois e-mails não são iguais. Confira para receber os avisos do pedido."; $("email2").focus(); return; }
      if (!cpfValido(v("cpf"))) { erro.textContent = "CPF inválido."; $("cpf").focus(); return; }
      if (!estado.opcoes || !estado.opcoes.length) { erro.textContent = "Escolha uma forma de entrega (informe o CEP)."; $("cep").focus(); return; }
      if (!estado.frete_id) { erro.textContent = "Escolha uma forma de entrega."; return; }
      if (!$("aceite").checked) { erro.textContent = "É preciso aceitar a Política de Privacidade para continuar."; return; }
      var botao = $("enviar"); botao.disabled = true; botao.textContent = "Criando o pedido…";
      enviarJson("/api/pedidos", {
        itens: itens,
        cliente: { nome: v("nome"), email: v("email"), telefone: v("telefone"), cpf: v("cpf"), cep: v("cep"), rua: v("rua"), numero: v("numero"), complemento: v("complemento"),
                   bairro: v("bairro"), cidade: v("cidade"), uf: v("uf"), cupom: estado.cupom, frete_id: estado.frete_id, aceite: true }
      }).then(function (r) {
        if (!r.ok) {
          erro.textContent = (r.dados && r.dados.erro) || "Não foi possível criar o pedido.";
          if (r.dados && r.dados.codigo === "estoque") erro.innerHTML = esc(erro.textContent) + ' <a href="carrinho.html">Ver carrinho</a>';
          botao.disabled = false; botao.textContent = "Ir para o pagamento"; return;
        }
        try { localStorage.setItem("melty_pedido", r.dados.token); } catch (e) { /* ignora */ }
        salvarCarrinho({}); atualizarBadge();
        location.href = r.dados.url;
      }).catch(function () { erro.textContent = "Sem conexão. Tente de novo."; botao.disabled = false; botao.textContent = "Ir para o pagamento"; });
    };
  }

  /* ---------- acompanhamento do pedido ---------- */
  function quando(sql) {
    if (!sql) return "";
    return new Date(sql.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  var ETAPAS = [["aguardando_pagamento", "Pedido recebido"], ["pago", "Pagamento confirmado"], ["em_producao", "Em produção"], ["enviado", "Enviado"], ["entregue", "Entregue"]];

  function paginaPedido(d) {
    var token = new URLSearchParams(location.search).get("t") || "";
    var app = document.getElementById("app");
    var timer = null;
    function desenhar(p) {
      var idx = ETAPAS.map(function (e) { return e[0]; }).indexOf(p.status);
      var etapas = idx < 0 ? "" : '<ol class="etapas">' + ETAPAS.map(function (e, i) {
        var h = p.historico.filter(function (x) { return x.tipo === (e[0] === "aguardando_pagamento" ? "criado" : e[0]); })[0];
        return '<li class="' + (i < idx ? "feito" : i === idx ? "atual" : "") + '"><b>' + e[1] + "</b>" + (h ? "<span>" + esc(quando(h.quando)) + "</span>" : "") + "</li>";
      }).join("") + "</ol>";
      var aviso = "";
      if (p.status === "cancelado") aviso = '<div class="notice">Este pedido foi cancelado. Se já pagou, fale com a gente pelo WhatsApp.</div>';
      if (p.status === "reembolsado") aviso = '<div class="notice">O pagamento deste pedido foi reembolsado.</div>';
      if (p.status === "aguardando_pagamento") aviso = '<div class="notice"><strong>Falta pagar.</strong> Reservamos seus itens até ' + esc(quando(p.expira_em)) + '. <p><a class="btn" href="' + esc(p.pagamento_url) + '">Pagar agora</a></p></div>';
      var rastreio = p.rastreio ? '<div class="notice"><strong>Código de rastreio:</strong> ' + esc(p.rastreio) + ' · <a href="' + esc(p.rastreio_url) + '" target="_blank" rel="noopener">acompanhar a entrega</a></div>' : "";
      app.innerHTML = '<div class="wrap page"><h1>Pedido #' + p.numero + "</h1><p class='muted'>Olá, " + esc(p.primeiro_nome) + "! Entrega em " + esc(p.cidade) + "/" + esc(p.uf) + (p.entrega ? " · " + esc(p.entrega) + (p.prazo_transporte_dias !== null && p.prazo_transporte_dias !== undefined ? " (transporte: " + p.prazo_transporte_dias + " dia(s) útil(eis) após a postagem)" : "") : "") + ".</p>" +
        aviso + rastreio + etapas +
        "<h2>Itens</h2>" + p.itens.map(function (i) { return '<div class="linha-res"><span>' + i.qtd + "× " + esc(i.nome) + "</span><span>" + brl.format(i.subtotal) + "</span></div>"; }).join("") +
        '<div class="linha-res"><span>Subtotal</span><span>' + brl.format(p.subtotal) + "</span></div>" +
        (p.desconto > 0 ? '<div class="linha-res desc"><span>Desconto' + (p.cupom ? " (" + esc(p.cupom) + ")" : "") + "</span><span>− " + brl.format(p.desconto) + "</span></div>" : "") +
        '<div class="linha-res"><span>Frete</span><span>' + (p.frete > 0 ? brl.format(p.frete) : "Grátis") + "</span></div>" +
        '<div class="linha-res total"><span>Total</span><span>' + brl.format(p.total) + "</span></div>" +
        '<p class="small muted">Guarde este endereço (link) para acompanhar o pedido. Dúvidas? <a href="https://wa.me/' + esc(d.config.whatsapp) + '" rel="noopener">Fale com a gente</a>.</p></div>';
    }
    function buscar() {
      return fetch("/api/pedidos/" + encodeURIComponent(token), { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("nao_encontrado");
        return r.json();
      }).then(function (p) { desenhar(p); if (p.status !== "aguardando_pagamento" && timer) { clearInterval(timer); timer = null; } return p; });
    }
    if (!/^[a-f0-9]{32}$/.test(token)) { app.innerHTML = '<div class="wrap page"><h1>Pedido não encontrado</h1><p>Confira o link que enviamos para você.</p></div>'; return; }
    buscar().then(function (p) {
      if (p.status === "aguardando_pagamento") timer = setInterval(function () { buscar().catch(function () {}); }, 10000);
    }).catch(function () { app.innerHTML = '<div class="wrap page"><h1>Pedido não encontrado</h1><p>Confira o link que enviamos para você.</p></div>'; });
  }

  /* ---------- pagamento de teste (só desenvolvimento) ---------- */
  function paginaTeste(d) {
    var token = new URLSearchParams(location.search).get("t") || "";
    var app = document.getElementById("app");
    app.innerHTML = '<div class="wrap page"><h1>Pagamento de teste</h1><div class="notice"><strong>Ambiente de teste.</strong> Esta tela só existe em desenvolvimento e simula o aviso do provedor de pagamento. Nenhum dinheiro é cobrado.</div>' +
      '<p><button class="btn" data-a="aprovar">Simular pagamento aprovado</button></p>' +
      '<p><button class="btn ghost" data-a="recusar">Simular pagamento recusado</button></p>' +
      '<p><button class="btn ghost" data-a="aprovar_outro_cpf">Aprovado, mas pago com outro CPF</button></p>' +
      '<p><button class="btn ghost" data-a="aprovar_valor_menor">Aprovado com valor menor</button></p>' +
      '<p><a href="pedido.html?t=' + esc(token) + '">Ver o pedido</a></p><p id="msg" class="small"></p></div>';
    app.querySelectorAll("button[data-a]").forEach(function (b) {
      b.onclick = function () {
        enviarJson("/api/pagamento-teste/" + encodeURIComponent(token), { acao: b.getAttribute("data-a") }).then(function (r) {
          if (!r.ok) { document.getElementById("msg").textContent = r.dados.erro || "Erro."; return; }
          location.href = "pedido.html?t=" + encodeURIComponent(token);
        });
      };
    });
  }

  /* ---------- política de privacidade ---------- */
  function paginaPrivacidade(d) {
    var c = d.config;
    document.getElementById("app").innerHTML = '<div class="wrap page"><h1>Política de Privacidade</h1>' +
      '<p class="muted small">Última atualização: ' + new Date().getFullYear() + ". Texto-base, sujeito a revisão.</p>" +
      "<h2>Quais dados coletamos</h2><p>Para vender e entregar suas velas, pedimos: nome, e-mail, telefone, CPF e endereço de entrega. O pagamento é processado por um provedor de pagamento (você é levado à página dele); nós não vemos nem guardamos dados do seu cartão.</p>" +
      "<h2>Para que usamos</h2><p>Processar e entregar o pedido, avisar você sobre o andamento, emitir o pagamento, controlar o uso de cupons de desconto e cumprir obrigações legais e fiscais.</p>" +
      "<h2>CPF e cupons</h2><p>Os cupons são vinculados ao CPF para evitar uso repetido. Para isso, guardamos uma versão embaralhada do CPF (que não permite descobrir o número original) e, no pedido, o CPF completo, que só a loja acessa.</p>" +
      "<h2>Com quem compartilhamos</h2><p>Apenas com quem é necessário para a compra: o provedor de pagamento e a transportadora (nome, endereço e telefone para a entrega). Não vendemos seus dados.</p>" +
      "<h2>Por quanto tempo guardamos</h2><p>Pelo tempo necessário para a entrega, garantia e obrigações legais. Depois disso, os dados são apagados ou anonimizados.</p>" +
      "<h2>Seus direitos</h2><p>Você pode pedir a confirmação do tratamento, acesso, correção, anonimização ou exclusão dos seus dados, entre outros direitos da LGPD (Lei 13.709/2018). Escreva para <a href=\"mailto:" + esc(c.email) + "\">" + esc(c.email) + "</a>.</p>" +
      "<h2>Cookies e armazenamento local</h2><p>Guardamos no seu navegador apenas o conteúdo do carrinho e o último pedido, para a loja funcionar. Não usamos cookies de publicidade.</p></div>";
  }

  /* ---------- prazos ---------- */
  function paginaPrazos(d) {
    document.getElementById("app").innerHTML =
      '<div class="wrap page"><h1>Prazos e Envio</h1>' + avisoPrazo(d.config) +
      "<h2>Produção</h2><p>Cada vela é preparada após a confirmação do pagamento, em até <strong>" +
      esc(d.config.prazo_producao_dias_uteis) + " dias úteis</strong>.</p>" +
      "<h2>Transporte</h2><p>O prazo de transporte é estimado conforme o seu CEP e a modalidade escolhida, contado em dias úteis a partir da postagem.</p>" +
      "<h2>Imprevistos</h2><p>Greves, feriados, clima ou áreas de difícil acesso podem afetar a entrega. Nesses casos, acompanhamos o rastreio e ajudamos você a resolver.</p>" +
      "<h2>Rastreamento</h2><p>Enviamos o código de rastreio assim que o pedido for postado.</p>" +
      "<h2>Embalagem</h2><p>As velas seguem em embalagem reforçada. Em dias muito quentes, mantenha a vela em local fresco após o recebimento.</p>" +
      '<h2>Dúvidas?</h2><p><a href="https://wa.me/' + esc(d.config.whatsapp) + '" rel="noopener">Fale com a gente pelo WhatsApp</a>.</p></div>';
  }

  /* ---------- início ---------- */
  var paginas = { home: paginaHome, catalogo: paginaCatalogo, produto: paginaProduto, carrinho: paginaCarrinho, prazos: paginaPrazos, checkout: paginaCheckout, pedido: paginaPedido, teste: paginaTeste, privacidade: paginaPrivacidade };
  carregar().then(function (d) {
    montarLayout(d);
    var tipo = document.body.getAttribute("data-page");
    (paginas[tipo] || paginaHome)(d);
    if (location.hash) { var alvo = document.getElementById(location.hash.slice(1)); if (alvo) alvo.scrollIntoView(); }
  }).catch(function () {
    document.getElementById("app").innerHTML =
      '<div class="wrap page"><p>Não foi possível carregar a loja. Abra o site por um servidor (veja o README).</p></div>';
  });
})();
