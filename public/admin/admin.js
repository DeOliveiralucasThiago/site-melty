/* Painel da loja Melty. Sem dependências. Todo texto é inserido com textContent (nunca innerHTML). */
(function () {
  "use strict";

  var raiz = document.getElementById("raiz");
  var S = { produtos: [], categorias: [], banners: [], cupons: [], pedidos: [], config: {} };
  var abaAtual = "pedidos";

  /* ---------- utilidades de interface ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v === null || v === undefined) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "value" || k === "checked" || k === "disabled" || k === "selected") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    });
    for (var i = 2; i < arguments.length; i++) filhos(el, arguments[i]);
    return el;
  }
  function filhos(el, f) {
    if (f === null || f === undefined || f === false) return;
    if (Array.isArray(f)) f.forEach(function (x) { filhos(el, x); });
    else el.appendChild(typeof f === "string" || typeof f === "number" ? document.createTextNode(String(f)) : f);
  }
  function limpar(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  function aviso(texto, tipo) {
    var box = document.getElementById("avisos");
    var el = h("div", { class: "aviso " + (tipo || "") }, texto);
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, tipo === "erro" ? 6000 : 2500);
  }

  function reais(n) { return "R$ " + Number(n).toFixed(2).replace(".", ","); }
  function lerReais(t) {
    t = String(t).replace(/[R$\s]/g, "");
    if (t.indexOf(",") >= 0) t = t.replace(/\./g, "").replace(",", ".");
    return Number(t);
  }
  var foto = function (id) { return "/img/" + id; };

  /* ---------- API ---------- */
  function api(metodo, caminho, corpo) {
    var opc = { method: metodo, credentials: "same-origin", headers: { "X-Requested-With": "melty" } };
    if (corpo instanceof Blob) { opc.body = corpo; opc.headers["content-type"] = corpo.type; }
    else if (corpo !== undefined) { opc.body = JSON.stringify(corpo); opc.headers["content-type"] = "application/json"; }
    return fetch("/api/admin" + caminho, opc).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (dados) {
        if (r.status === 401 && caminho !== "/login" && caminho !== "/sessao") { telaLogin("Sua sessão expirou. Entre novamente."); throw new Error("sessão"); }
        if (!r.ok) throw new Error(dados.erro || "Algo deu errado. Tente de novo.");
        return dados;
      });
    });
  }
  function acao(promessa, sucesso) {
    return promessa.then(function (r) { if (sucesso) aviso(sucesso, "ok"); return r; })
      .catch(function (e) { if (e.message !== "sessão") aviso(e.message, "erro"); throw e; });
  }

  /* ---------- fotos: reduz no navegador e envia ---------- */
  function paraBlob(canvas, tipo, qualidade) {
    return new Promise(function (ok) { canvas.toBlob(ok, tipo, qualidade); });
  }
  function enviarImagem(arquivo, maxLado) {
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return Promise.reject(new Error("Use uma foto JPG, PNG ou WebP."));
    return createImageBitmap(arquivo, { imageOrientation: "from-image" }).then(function (bmp) {
      var escala = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
      var c = document.createElement("canvas");
      c.width = Math.round(bmp.width * escala); c.height = Math.round(bmp.height * escala);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return paraBlob(c, "image/webp", 0.82).then(function (b) {
        if (!b || b.type !== "image/webp") return paraBlob(c, "image/jpeg", 0.85);
        return b;
      }).then(function (b) {
        if (b.size > 950000) return paraBlob(c, b.type, 0.6);
        return b;
      });
    }).then(function (blob) {
      if (blob.size > 1000000) throw new Error("A foto ainda ficou grande demais. Tente uma foto menor.");
      return api("POST", "/imagens", blob);
    });
  }
  // Botão "escolher fotos" que devolve os ids enviados
  function seletorFotos(rotulo, multiplo, maxLado, aoEnviar) {
    var entrada = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", multiple: multiplo, hidden: true });
    var botao = h("button", { type: "button", class: "btn sec mini", onclick: function () { entrada.click(); } }, rotulo);
    entrada.addEventListener("change", function () {
      var arquivos = Array.prototype.slice.call(entrada.files);
      if (!arquivos.length) return;
      botao.disabled = true; botao.textContent = "Enviando…";
      arquivos.reduce(function (p, a) {
        return p.then(function (ids) { return enviarImagem(a, maxLado).then(function (r) { return ids.concat(r.id); }); });
      }, Promise.resolve([])).then(function (ids) { aoEnviar(ids); })
        .catch(function (e) { if (e.message !== "sessão") aviso(e.message, "erro"); })
        .then(function () { botao.disabled = false; botao.textContent = rotulo; entrada.value = ""; });
    });
    return h("span", null, botao, entrada);
  }


  /* ---------- editor de texto com formatação limitada ---------- */
  function escHtml(t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function editorTexto(htmlInicial) {
    var area = h("div", { class: "editor", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Descrição" });
    area.innerHTML = htmlInicial || "<p><br></p>"; // vem do servidor já limpo
    try { document.execCommand("defaultParagraphSeparator", false, "p"); document.execCommand("styleWithCSS", false, false); } catch (e) { /* ignora */ }

    function dentro() { var s = window.getSelection(); return s.rangeCount && area.contains(s.getRangeAt(0).commonAncestorContainer) ? s : null; }
    function cmd(nome, valor) { area.focus(); document.execCommand(nome, false, valor || null); }
    // Cores da marca. Usa classes (sem estilos inline, que o painel bloqueia por segurança) e preserva negrito/itálico.
    var TEXTO = ["cor-vinho", "cor-rosa"], FUNDO = ["marca-rosa"], TODAS = TEXTO.concat(FUNDO);
    function nosDoTrecho(r) {
      // separa os textos das pontas, para colorir só o que foi selecionado
      if (r.endContainer.nodeType === 3 && r.endOffset < r.endContainer.length) r.endContainer.splitText(r.endOffset);
      if (r.startContainer.nodeType === 3 && r.startOffset > 0) r.setStart(r.startContainer.splitText(r.startOffset), 0);
      var raiz = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
      var w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT), nos = [], n;
      while ((n = w.nextNode())) if (n.nodeValue.trim() !== "" || nos.length) { if (r.intersectsNode(n)) nos.push(n); }
      return nos.filter(function (x) { return x.nodeValue !== ""; });
    }
    function marcar(classe) {
      var sel = dentro();
      if (!sel || sel.isCollapsed) { aviso("Selecione primeiro o trecho do texto.", "erro"); return; }
      area.focus();
      var nos = nosDoTrecho(sel.getRangeAt(0));
      if (!nos.length) return;
      nos.forEach(function (n) {
        var pai = n.parentNode;
        var span = pai.tagName === "SPAN" && pai.childNodes.length === 1 && TODAS.some(function (c) { return pai.classList.contains(c); }) ? pai : null;
        if (classe === null) { if (span) TODAS.forEach(function (c) { span.classList.remove(c); }); return; }
        if (!span) { span = document.createElement("span"); pai.insertBefore(span, n); span.appendChild(n); }
        (FUNDO.indexOf(classe) >= 0 ? FUNDO : TEXTO).forEach(function (c) { span.classList.remove(c); });
        span.classList.add(classe);
      });
      Array.prototype.slice.call(area.querySelectorAll("span")).forEach(function (sp) {
        if (!sp.className) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.parentNode.removeChild(sp); }
      });
      var nr = document.createRange(); nr.setStartBefore(nos[0]); nr.setEndAfter(nos[nos.length - 1]);
      sel.removeAllRanges(); sel.addRange(nr);
    }
    function botao(rotulo, titulo, fn, extra) {
      return h("button", { type: "button", title: titulo, "aria-label": titulo, class: extra || "", onmousedown: function (e) { e.preventDefault(); }, onclick: fn }, rotulo);
    }
    var barra = h("div", { class: "barra-fmt", role: "toolbar", "aria-label": "Formatação" },
      botao(h("b", null, "N"), "Negrito", function () { cmd("bold"); }),
      botao(h("i", null, "I"), "Itálico", function () { cmd("italic"); }),
      botao("Subtítulo", "Transformar em subtítulo (ou voltar a parágrafo)", function () { cmd("formatBlock", document.queryCommandValue("formatBlock") === "h3" ? "p" : "h3"); }),
      botao("• Lista", "Lista com marcadores", function () { cmd("insertUnorderedList"); }),
      botao("1. Lista", "Lista numerada", function () { cmd("insertOrderedList"); }),
      h("span", { class: "sep" }),
      botao(h("span", { class: "cor-vinho" }, "Vinho"), "Texto na cor vinho", function () { marcar("cor-vinho"); }),
      botao(h("span", { class: "cor-rosa" }, "Rosa"), "Texto na cor rosa", function () { marcar("cor-rosa"); }),
      botao(h("span", { class: "marca-rosa" }, "Marca-texto"), "Fundo rosa claro, como um marca-texto", function () { marcar("marca-rosa"); }),
      botao("Sem cor", "Tirar a cor do trecho selecionado", function () { marcar(null); }),
      h("span", { class: "sep" }),
      botao("Link", "Transformar o trecho selecionado em link", function () {
        if (!dentro() || dentro().isCollapsed) { aviso("Selecione primeiro o texto que vai virar link.", "erro"); return; }
        var url = prompt("Endereço do link (começa com https://):", "https://");
        if (!url) return;
        url = url.trim(); if (!/^https?:\/\//i.test(url)) url = "https://" + url;
        if (!/^https:\/\//i.test(url)) { aviso("Use um endereço seguro, que comece com https://", "erro"); return; }
        cmd("createLink", url);
      }),
      botao("Sem link", "Tirar o link do trecho selecionado", function () { cmd("unlink"); }),
      botao("Limpar", "Tirar toda a formatação do trecho selecionado", function () { cmd("removeFormat"); marcar(null); }));

    // Colar sempre como texto simples (mantém os parágrafos), para não trazer fontes e cores de outros lugares
    area.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain").replace(/\r\n?/g, "\n").trim();
      if (!t) return;
      document.execCommand("insertHTML", false, t.split(/\n\s*\n/).map(function (b) { return "<p>" + escHtml(b).replace(/\n/g, "<br>") + "</p>"; }).join(""));
    });
    return { el: h("div", null, barra, area), obter: function () { return area.innerHTML; } };
  }

  /* ---------- login ---------- */
  function telaLogin(mensagem) {
    limpar(raiz);
    var erro = h("p", { class: "erro", role: "alert" }, mensagem || "");
    var senha = h("input", { type: "password", autocomplete: "current-password", required: true, id: "senha" });
    raiz.appendChild(h("div", { class: "login" },
      h("h1", null, "MELTY"), h("p", { class: "dica" }, "Painel da loja. Digite a senha para entrar."),
      h("form", { onsubmit: function (ev) {
        ev.preventDefault();
        api("POST", "/login", { senha: senha.value }).then(iniciar).catch(function (e) { erro.textContent = e.message; senha.select(); });
      } }, h("label", { for: "senha" }, "Senha"), senha, erro, h("button", { class: "btn", type: "submit" }, "Entrar"))));
    senha.focus();
  }

  /* ---------- estrutura geral ---------- */
  var ABAS = [["pedidos", "Pedidos"], ["produtos", "Produtos"], ["categorias", "Categorias"], ["banners", "Banners"], ["cupons", "Cupons"], ["textos", "Textos e contato"]];

  function carregarTudo() {
    return Promise.all([api("GET", "/produtos"), api("GET", "/categorias"), api("GET", "/banners"), api("GET", "/config"), api("GET", "/cupons"), api("GET", "/pedidos")]).then(function (v) {
      S.produtos = v[0]; S.categorias = v[1]; S.banners = v[2]; S.config = v[3]; S.cupons = v[4]; S.pedidos = v[5];
    });
  }

  function iniciar() {
    carregarTudo().then(desenhar).catch(function (e) { if (e.message !== "sessão") telaLogin(e.message); });
  }

  function desenhar() {
    limpar(raiz);
    var main = h("main");
    raiz.appendChild(h("div", { class: "topo" }, h("b", null, "MELTY · PAINEL"),
      h("span", null, h("a", { href: "/", target: "_blank", rel: "noopener" }, "Ver a loja"),
        h("button", { type: "button", onclick: function () { api("POST", "/logout").then(function () { telaLogin(); }); } }, "Sair"))));
    raiz.appendChild(h("div", { class: "abas", role: "tablist" }, ABAS.map(function (a) {
      var novos = a[0] === "pedidos" ? S.pedidos.filter(function (p) { return p.status === "pago"; }).length : 0;
      return h("button", { role: "tab", "aria-selected": abaAtual === a[0] ? "true" : "false", onclick: function () { abaAtual = a[0]; desenhar(); } }, a[1], novos ? h("span", { class: "etq" }, String(novos)) : null);
    })));
    raiz.appendChild(main);
    ({ pedidos: abaPedidos, produtos: abaProdutos, categorias: abaCategorias, banners: abaBanners, cupons: abaCupons, textos: abaTextos })[abaAtual](main);
  }
  function recarregar() { return carregarTudo().then(desenhar); }

  function nomeCategoria(id) {
    var c = S.categorias.filter(function (x) { return x.id === id; })[0];
    return c ? c.nome : "Sem categoria";
  }

  /* ========== PRODUTOS ========== */
  function abaProdutos(main) {
    var busca = h("input", { type: "text", placeholder: "Buscar produto…", "aria-label": "Buscar produto" });
    var lista = h("div");
    function filtrar() {
      limpar(lista);
      var t = busca.value.trim().toLowerCase();
      var itens = S.produtos.filter(function (p) { return !t || p.nome.toLowerCase().indexOf(t) >= 0; });
      if (!itens.length) lista.appendChild(h("p", { class: "vazio" }, S.produtos.length ? "Nenhum produto encontrado." : "Ainda não há produtos. Clique em “Novo produto”."));
      itens.forEach(function (p) { lista.appendChild(linhaProduto(p)); });
    }
    busca.addEventListener("input", filtrar);
    main.appendChild(h("h1", null, "Produtos"));
    main.appendChild(h("p", { class: "dica" }, "Altere o estoque direto na lista. Para mudar preço, fotos ou descrição, clique em Editar."));
    main.appendChild(h("div", { class: "barra" }, h("div", { class: "espaco" }, busca),
      h("button", { class: "btn", onclick: function () { formProduto(null); } }, "+ Novo produto")));
    main.appendChild(lista);
    filtrar();
  }

  function linhaProduto(p) {
    function salvarEstoque(valor) {
      valor = Math.max(0, Math.min(9999, parseInt(valor, 10) || 0));
      acao(api("PATCH", "/produtos/" + encodeURIComponent(p.id), { estoque: valor }), "Estoque atualizado.").then(function (r) {
        p.estoque = r.estoque; entrada.value = r.estoque; etiquetas();
      }).catch(function () { entrada.value = p.estoque; });
    }
    var entrada = h("input", { type: "number", min: "0", max: "9999", value: p.estoque, "aria-label": "Estoque de " + p.nome,
      onchange: function () { salvarEstoque(entrada.value); } });
    var etq = h("span");
    function etiquetas() {
      limpar(etq);
      if (!p.ativo) etq.appendChild(h("span", { class: "etq cinza" }, "Oculto"));
      if (p.estoque === 0) etq.appendChild(h("span", { class: "etq vermelha" }, "Esgotado"));
      if (p.promocao_vigente) etq.appendChild(h("span", { class: "etq" }, "Promoção"));
      else if (p.preco_promo) etq.appendChild(h("span", { class: "etq cinza" }, "Promoção agendada/encerrada"));
      if (p.novidade) etq.appendChild(h("span", { class: "etq" }, "Novidade"));
      if (p.destaque) etq.appendChild(h("span", { class: "etq" }, "Mais vendida"));
    }
    etiquetas();
    return h("div", { class: "cartao" }, h("div", { class: "linha" },
      p.imagens.length ? h("img", { src: foto(p.imagens[0]), alt: "" }) : h("div", { class: "miniatura" }),
      h("div", null, h("div", { class: "nome" }, p.nome, etq), h("div", { class: "meta" }, (p.preco_promo ? reais(p.preco) + " → promo " + reais(p.preco_promo) : reais(p.preco)) + " · " + nomeCategoria(p.categoria))),
      h("div", { class: "acoes extra" },
        h("div", { class: "estoque" }, h("span", { class: "meta" }, "Estoque"),
          h("button", { type: "button", "aria-label": "Diminuir estoque", onclick: function () { salvarEstoque(p.estoque - 1); } }, "−"), entrada,
          h("button", { type: "button", "aria-label": "Aumentar estoque", onclick: function () { salvarEstoque(p.estoque + 1); } }, "+")),
        h("button", { class: "btn sec mini", onclick: function () { formProduto(p); } }, "Editar"))));
  }

  function formProduto(p) {
    var novo = !p;
    var d = p || { nome: "", descricao: "", preco: "", estoque: 1, categoria: S.categorias.length ? S.categorias[0].id : "", peso_kg: 0.42, preco_promo: null, promo_inicio: "", promo_fim: "", imagens: [], novidade: false, destaque: false, ativo: true, ordem: S.produtos.length };
    var imagens = d.imagens.slice();
    var dlg = h("dialog");
    var f = {
      nome: h("input", { type: "text", maxlength: "80", required: true, value: d.nome }),
      categoria: h("select", null, h("option", { value: "" }, "Sem categoria"),
        S.categorias.map(function (c) { return h("option", { value: c.id, selected: c.id === d.categoria }, c.nome); })),
      preco: h("input", { type: "text", inputmode: "decimal", required: true, value: d.preco === "" ? "" : Number(d.preco).toFixed(2).replace(".", ","), placeholder: "79,90" }),
      estoque: h("input", { type: "number", min: "0", max: "9999", required: true, value: d.estoque }),
      peso: h("input", { type: "text", inputmode: "decimal", value: String(d.peso_kg).replace(".", ",") }),
      promo: h("input", { type: "text", inputmode: "decimal", value: d.preco_promo ? Number(d.preco_promo).toFixed(2).replace(".", ",") : "", placeholder: "Opcional" }),
      promoIni: h("input", { type: "date", value: d.promo_inicio || "" }),
      promoFim: h("input", { type: "date", value: d.promo_fim || "" }),
      ordem: h("input", { type: "number", min: "0", max: "9999", value: d.ordem }),
      ativo: h("input", { type: "checkbox", checked: d.ativo }),
      novidade: h("input", { type: "checkbox", checked: d.novidade }),
      destaque: h("input", { type: "checkbox", checked: d.destaque })
    };
    var editor = editorTexto(d.descricao);
    var area = h("div", { class: "fotos" });
    function mostrarFotos() {
      limpar(area);
      imagens.forEach(function (id, i) {
        area.appendChild(h("div", { class: "foto" }, h("img", { src: foto(id), alt: "Foto " + (i + 1) }),
          i === 0 ? h("span", { class: "principal" }, "Principal") : null,
          h("div", null,
            h("button", { type: "button", "aria-label": "Mover para antes", disabled: i === 0, onclick: function () { imagens.splice(i - 1, 0, imagens.splice(i, 1)[0]); mostrarFotos(); } }, "←"),
            h("button", { type: "button", "aria-label": "Mover para depois", disabled: i === imagens.length - 1, onclick: function () { imagens.splice(i + 1, 0, imagens.splice(i, 1)[0]); mostrarFotos(); } }, "→"),
            h("button", { type: "button", "aria-label": "Remover foto", onclick: function () { imagens.splice(i, 1); mostrarFotos(); } }, "✕"))));
      });
      if (!imagens.length) area.appendChild(h("p", { class: "dica" }, "Nenhuma foto ainda."));
    }
    mostrarFotos();

    function campo(rotulo, el, dica) { return h("div", null, h("label", null, rotulo), el, dica ? h("p", { class: "dica" }, dica) : null); }
    var form = h("form", { method: "dialog", onsubmit: function (ev) {
      ev.preventDefault();
      var corpo = {
        nome: f.nome.value, categoria: f.categoria.value || null, preco: lerReais(f.preco.value), estoque: Number(f.estoque.value),
        peso_kg: lerReais(f.peso.value || "0,42"), ordem: Number(f.ordem.value || 0), descricao: editor.obter(),
        preco_promo: f.promo.value.trim() ? lerReais(f.promo.value) : null, promo_inicio: f.promoIni.value || null, promo_fim: f.promoFim.value || null,
        ativo: f.ativo.checked, novidade: f.novidade.checked, destaque: f.destaque.checked, imagens: imagens
      };
      var salvar = novo ? api("POST", "/produtos", corpo) : api("PUT", "/produtos/" + encodeURIComponent(p.id), corpo);
      acao(salvar, "Produto salvo.").then(function () { dlg.close(); return recarregar(); }).catch(function () {});
    } },
      h("h2", null, novo ? "Novo produto" : "Editar produto"),
      campo("Nome", f.nome),
      h("div", { class: "grade2" }, campo("Categoria", f.categoria), campo("Preço (R$)", f.preco)),
      h("div", { class: "grade3" }, campo("Preço promocional (R$)", f.promo, "Vazio = sem promoção. A loja mostra o preço antigo riscado."),
        campo("Promoção começa", f.promoIni, "Opcional. Vazio = já valendo."), campo("Promoção termina", f.promoFim, "Último dia. Vazio = sem data para acabar.")),
      h("div", { class: "grade3" }, campo("Estoque", f.estoque), campo("Peso (kg)", f.peso, "Com a embalagem, para o frete."), campo("Posição na loja", f.ordem, "Menor número aparece primeiro.")),
      h("label", null, "Descrição"), editor.el,
      h("p", { class: "dica" }, "Selecione um trecho e use os botões para formatar. Cores disponíveis: as da marca. Fonte e tamanho seguem o padrão da loja."),
      h("label", null, "Fotos"), area,
      seletorFotos("+ Adicionar fotos", true, 1200, function (ids) { imagens = imagens.concat(ids).slice(0, 8); mostrarFotos(); }),
      h("p", { class: "dica" }, "Até 8 fotos. A primeira é a principal. Elas são reduzidas automaticamente."),
      h("label", { class: "chk" }, f.ativo, "Aparece na loja"),
      h("label", { class: "chk" }, f.novidade, "Mostrar na seção “Novidades”"),
      h("label", { class: "chk" }, f.destaque, "Mostrar na seção “Mais vendidas”"),
      h("div", { class: "barra" },
        h("button", { class: "btn", type: "submit" }, "Salvar"),
        h("button", { class: "btn sec", type: "button", onclick: function () { dlg.close(); } }, "Cancelar"),
        h("span", { class: "espaco" }),
        novo ? null : h("button", { class: "btn perigo", type: "button", onclick: function () {
          if (!confirm("Excluir “" + p.nome + "” de vez? Isso não pode ser desfeito.\n\nDica: para só esconder da loja, desmarque “Aparece na loja”.")) return;
          acao(api("DELETE", "/produtos/" + encodeURIComponent(p.id)), "Produto excluído.").then(function () { dlg.close(); return recarregar(); }).catch(function () {});
        } }, "Excluir")));
    dlg.appendChild(form);
    dlg.addEventListener("close", function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
    document.body.appendChild(dlg);
    dlg.showModal();
    f.nome.focus();
  }

  /* ========== CATEGORIAS ========== */
  function renumerar(lista, rota) {
    return Promise.all(lista.map(function (x, i) {
      if (x.ordem === i) return null;
      x.ordem = i;
      return api("PATCH", rota + encodeURIComponent(x.id), { ordem: i });
    }));
  }
  function mover(lista, i, delta, rota) {
    var j = i + delta;
    if (j < 0 || j >= lista.length) return;
    lista.splice(j, 0, lista.splice(i, 1)[0]);
    acao(renumerar(lista, rota)).then(recarregar).catch(function () {});
  }

  function promoCategoria(c) {
    var pct = h("input", { type: "number", min: "1", max: "90", placeholder: "Ex.: 10", "aria-label": "Desconto em porcentagem" });
    var ini = h("input", { type: "date", "aria-label": "Início" }), fim = h("input", { type: "date", "aria-label": "Fim" });
    return h("details", null, h("summary", null, "Promoção em todos os produtos desta categoria"),
      h("p", { class: "dica" }, "Grava o preço promocional de cada produto (você pode ajustar um por um depois, em Produtos)."),
      h("div", { class: "grade3" }, h("div", null, h("label", null, "Desconto (%)"), pct), h("div", null, h("label", null, "Começa em (opcional)"), ini), h("div", null, h("label", null, "Termina em (opcional)"), fim)),
      h("div", { class: "barra" },
        h("button", { class: "btn mini", type: "button", onclick: function () {
          if (!pct.value) { aviso("Informe a porcentagem de desconto.", "erro"); return; }
          if (!confirm("Aplicar " + pct.value + "% de desconto em todos os produtos de “" + c.nome + "”? Promoções que já existirem neles serão substituídas.")) return;
          acao(api("POST", "/categorias/" + encodeURIComponent(c.id) + "/promocao", { percentual: Number(pct.value), inicio: ini.value || null, fim: fim.value || null }), "Promoção aplicada.").then(recarregar).catch(function () {});
        } }, "Aplicar desconto"),
        h("button", { class: "btn perigo mini", type: "button", onclick: function () {
          if (!confirm("Remover a promoção de todos os produtos de “" + c.nome + "”?")) return;
          acao(api("POST", "/categorias/" + encodeURIComponent(c.id) + "/promocao", { remover: true }), "Promoções removidas.").then(recarregar).catch(function () {});
        } }, "Remover promoções")));
  }

  function abaCategorias(main) {
    var nome = h("input", { type: "text", maxlength: "40", placeholder: "Ex.: Home Spray", "aria-label": "Nome da nova categoria" });
    main.appendChild(h("h1", null, "Categorias"));
    main.appendChild(h("p", { class: "dica" }, "Cada categoria visível e com produtos aparece sozinha no menu da loja."));
    main.appendChild(h("form", { class: "barra", onsubmit: function (ev) {
      ev.preventDefault();
      acao(api("POST", "/categorias", { nome: nome.value }), "Categoria criada.").then(recarregar).catch(function () {});
    } }, h("div", { class: "espaco" }, nome), h("button", { class: "btn", type: "submit" }, "+ Nova categoria")));

    if (!S.categorias.length) main.appendChild(h("p", { class: "vazio" }, "Nenhuma categoria ainda."));
    S.categorias.forEach(function (c, i) {
      var n = h("input", { type: "text", maxlength: "40", value: c.nome, "aria-label": "Nome" });
      var desc = h("input", { type: "text", maxlength: "200", value: c.descricao, "aria-label": "Descrição" });
      var ativa = h("input", { type: "checkbox", checked: c.ativa });
      main.appendChild(h("div", { class: "cartao" },
        h("div", { class: "grade2" }, h("div", null, h("label", null, "Nome"), n), h("div", null, h("label", null, "Descrição curta"), desc)),
        h("label", { class: "chk" }, ativa, "Visível na loja e no menu"),
        promoCategoria(c),
        h("div", { class: "barra" },
          h("span", { class: "meta dica" }, c.total + (c.total === 1 ? " produto" : " produtos")), h("span", { class: "espaco" }),
          h("button", { class: "btn sec mini", type: "button", disabled: i === 0, onclick: function () { mover(S.categorias, i, -1, "/categorias/"); } }, "↑ Subir"),
          h("button", { class: "btn sec mini", type: "button", disabled: i === S.categorias.length - 1, onclick: function () { mover(S.categorias, i, 1, "/categorias/"); } }, "↓ Descer"),
          h("button", { class: "btn mini", type: "button", onclick: function () {
            acao(api("PATCH", "/categorias/" + encodeURIComponent(c.id), { nome: n.value, descricao: desc.value, ativa: ativa.checked }), "Categoria salva.").then(recarregar).catch(function () {});
          } }, "Salvar"),
          h("button", { class: "btn perigo mini", type: "button", onclick: function () {
            if (!confirm("Excluir a categoria “" + c.nome + "”?")) return;
            acao(api("DELETE", "/categorias/" + encodeURIComponent(c.id)), "Categoria excluída.").then(recarregar).catch(function () {});
          } }, "Excluir"))));
    });
  }

  /* ========== BANNERS ========== */
  function abaBanners(main) {
    main.appendChild(h("h1", null, "Banners"));
    main.appendChild(h("p", { class: "dica" }, "Faixa de imagens no topo da página inicial. Com 2 ou mais banners visíveis, vira um carrossel. Tamanho ideal: 2000 × 530 pixels (faixa larga). No celular, as bordas podem ser cortadas, então deixe o assunto principal no centro."));
    main.appendChild(h("div", { class: "barra" }, seletorFotos("+ Novo banner", false, 2000, function (ids) {
      acao(api("POST", "/banners", { imagem_id: ids[0] }), "Banner criado. Preencha os textos, se quiser.").then(recarregar).catch(function () {});
    })));
    if (!S.banners.length) main.appendChild(h("p", { class: "vazio" }, "Nenhum banner ainda."));
    S.banners.forEach(function (b, i) {
      var f = {
        titulo: h("input", { type: "text", maxlength: "80", value: b.titulo, placeholder: "Opcional" }),
        botao: h("input", { type: "text", maxlength: "30", value: b.botao, placeholder: "Opcional. Ex.: Ver velas" }),
        link: h("input", { type: "text", maxlength: "300", value: b.link, placeholder: "Opcional. Ex.: catalogo.html" }),
        alt: h("input", { type: "text", maxlength: "200", value: b.alt, placeholder: "Descreva a imagem (ajuda quem usa leitor de tela)" }),
        ativo: h("input", { type: "checkbox", checked: b.ativo })
      };
      var img = h("img", { class: "banner-prev", src: foto(b.imagem_id), alt: "Banner " + (i + 1) });
      main.appendChild(h("div", { class: "cartao" }, img,
        h("div", { class: "grade2" }, h("div", null, h("label", null, "Título sobre a imagem"), f.titulo), h("div", null, h("label", null, "Texto do botão"), f.botao)),
        h("div", { class: "grade2" }, h("div", null, h("label", null, "Link ao clicar"), f.link), h("div", null, h("label", null, "Descrição da imagem"), f.alt)),
        h("label", { class: "chk" }, f.ativo, "Visível na loja"),
        h("div", { class: "barra" },
          seletorFotos("Trocar imagem", false, 2000, function (ids) {
            acao(api("PATCH", "/banners/" + b.id, { imagem_id: ids[0] }), "Imagem trocada.").then(recarregar).catch(function () {});
          }),
          h("span", { class: "espaco" }),
          h("button", { class: "btn sec mini", type: "button", disabled: i === 0, onclick: function () { mover(S.banners, i, -1, "/banners/"); } }, "↑ Subir"),
          h("button", { class: "btn sec mini", type: "button", disabled: i === S.banners.length - 1, onclick: function () { mover(S.banners, i, 1, "/banners/"); } }, "↓ Descer"),
          h("button", { class: "btn mini", type: "button", onclick: function () {
            acao(api("PATCH", "/banners/" + b.id, { titulo: f.titulo.value, botao: f.botao.value, link: f.link.value, alt: f.alt.value, ativo: f.ativo.checked }), "Banner salvo.").then(recarregar).catch(function () {});
          } }, "Salvar"),
          h("button", { class: "btn perigo mini", type: "button", onclick: function () {
            if (!confirm("Excluir este banner?")) return;
            acao(api("DELETE", "/banners/" + b.id), "Banner excluído.").then(recarregar).catch(function () {});
          } }, "Excluir"))));
    });
  }



  /* ========== PEDIDOS ========== */
  var STATUS_PED = { aguardando_pagamento: ["Aguardando pagamento", "cinza"], pago: ["Pago", ""], em_producao: ["Em produção", ""], enviado: ["Enviado", ""], entregue: ["Entregue", ""], cancelado: ["Cancelado", "cinza"], reembolsado: ["Reembolsado", "cinza"] };
  var PROXIMOS = { aguardando_pagamento: ["cancelado"], pago: ["em_producao", "enviado", "cancelado", "reembolsado"], em_producao: ["enviado", "cancelado", "reembolsado"], enviado: ["entregue", "cancelado", "reembolsado"], entregue: ["reembolsado"], cancelado: [], reembolsado: [] };
  var ROTULO_ACAO = { em_producao: "Marcar em produção", enviado: "Marcar como enviado", entregue: "Marcar como entregue", cancelado: "Cancelar pedido", reembolsado: "Marcar como reembolsado" };
  var EVENTO_TXT = { criado: "Pedido criado", pago: "Pagamento confirmado", em_producao: "Em produção", enviado: "Enviado", entregue: "Entregue", cancelado: "Cancelado", reembolsado: "Reembolsado", pagamento_recusado: "Pagamento recusado", revisao_resolvida: "Alerta conferido" };
  function dataHora(sql) { return sql ? new Date(sql.replace(" ", "T") + "Z").toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; }
  function fmtCpf(c) { return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4"); }
  function fmtTel(t) { return t.length === 11 ? t.replace(/^(\d{2})(\d{5})(\d{4})$/, "($1) $2-$3") : t.replace(/^(\d{2})(\d{4})(\d{4})$/, "($1) $2-$3"); }
  function copiar(texto) {
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject()).then(function () { aviso("Copiado.", "ok"); }, function () { aviso("Não foi possível copiar. Selecione o texto e copie.", "erro"); });
  }

  function abaPedidos(main) {
    var filtro = h("select", { "aria-label": "Filtrar por situação" }, h("option", { value: "" }, "Todos os pedidos"),
      Object.keys(STATUS_PED).map(function (k) { return h("option", { value: k }, STATUS_PED[k][0]); }));
    var lista = h("div");
    function carregar() {
      limpar(lista); lista.appendChild(h("p", { class: "dica" }, "Carregando…"));
      api("GET", "/pedidos" + (filtro.value ? "?status=" + filtro.value : "")).then(function (ps) {
        limpar(lista);
        if (!ps.length) { lista.appendChild(h("p", { class: "vazio" }, "Nenhum pedido por aqui ainda.")); return; }
        ps.forEach(function (p) {
          var st = STATUS_PED[p.status] || [p.status, ""];
          lista.appendChild(h("div", { class: "cartao clicavel", tabindex: "0", role: "button", onclick: function () { detalhePedido(p.id); }, onkeydown: function (e) { if (e.key === "Enter") detalhePedido(p.id); } },
            h("div", { class: "linha pedido" }, h("div", { class: "miniatura sigla" }, "#"),
              h("div", null, h("div", { class: "nome" }, "Pedido " + p.numero + " · " + p.cliente, h("span", { class: "etq " + st[1] }, st[0]),
                  p.revisao.length ? h("span", { class: "etq vermelha" }, "Conferir") : null),
                h("div", { class: "meta" }, reais(p.total) + " · " + p.itens + (p.itens === 1 ? " item" : " itens") + (p.cupom ? " · cupom " + p.cupom : "") + " · " + dataHora(p.criado_em))),
              h("div", { class: "acoes extra" }, h("span", { class: "btn sec mini" }, "Abrir")))));
        });
      }).catch(function (e) { limpar(lista); if (e.message !== "sessão") lista.appendChild(h("p", { class: "erro" }, e.message)); });
    }
    filtro.addEventListener("change", carregar);
    main.appendChild(h("h1", null, "Pedidos"));
    main.appendChild(h("p", { class: "dica" }, "Pedidos “Pago” são os que você precisa produzir e enviar. Pedidos marcados “Conferir” têm um alerta (por exemplo, CPF de quem pagou diferente do informado)."));
    main.appendChild(h("div", { class: "barra" }, h("div", { class: "espaco" }, filtro), h("button", { class: "btn sec", onclick: carregar }, "Atualizar")));
    main.appendChild(lista);
    carregar();
  }

  function detalhePedido(id, dlgExistente) {
    var corpo = h("div", null, h("p", { class: "dica" }, "Carregando…"));
    var dlg = dlgExistente || dialogo(function (d) { return h("form", { method: "dialog" }, corpo); });
    if (dlgExistente) { var f = dlgExistente.querySelector("form"); limpar(f); f.appendChild(corpo); }
    var dlgFecha = function () { dlg.close(); };
    api("GET", "/pedidos/" + id).then(function (p) { desenharDetalhe(p, corpo, dlgFecha, dlg); })
      .catch(function (e) { limpar(corpo); corpo.appendChild(h("p", { class: "erro" }, e.message)); });
  }

  function desenharDetalhe(p, corpo, fechar, dlg) {
    limpar(corpo);
    var st = STATUS_PED[p.status] || [p.status, ""];
    var e = p.endereco, c = p.cliente;
    var textoEnd = c.nome + "\n" + e.rua + ", " + e.numero + (e.complemento ? " - " + e.complemento : "") + "\n" + e.bairro + " - " + e.cidade + "/" + e.uf + "\nCEP " + e.cep.replace(/^(\d{5})(\d{3})$/, "$1-$2") + "\nTel. " + fmtTel(c.telefone);
    var link = location.origin + "/pedido.html?t=" + p.token;
    var rastreio = h("input", { type: "text", maxlength: "30", placeholder: "Código de rastreio (ex.: AB123456789BR)", value: p.rastreio || "", "aria-label": "Código de rastreio" });
    var proximos = PROXIMOS[p.status] || [];

    function mudar(novo) {
      var msg = novo === "cancelado" ? "Cancelar o pedido " + p.numero + "? Os itens voltam ao estoque (se ainda não foram enviados)." :
                novo === "reembolsado" ? "Marque só depois de ter feito o reembolso no painel do provedor de pagamento. Continuar?" : null;
      if (msg && !confirm(msg)) return;
      acao(api("POST", "/pedidos/" + p.id + "/status", { status: novo, rastreio: rastreio.value }), "Pedido atualizado.")
        .then(function (n) { desenharDetalhe(n, corpo, fechar, dlg); }).catch(function () {});
    }

    corpo.appendChild(h("h2", null, "Pedido " + p.numero, h("span", { class: "etq " + st[1] }, st[0])));
    corpo.appendChild(h("p", { class: "dica" }, "Feito em " + dataHora(p.criado_em) + (p.pago_em ? " · pago em " + dataHora(p.pago_em) : "") + (p.expira_em && p.status === "aguardando_pagamento" ? " · reserva até " + dataHora(p.expira_em) : "")));
    p.revisao.forEach(function (r) { corpo.appendChild(h("div", { class: "alerta" }, "⚠ " + r.texto)); });
    if (p.revisao.length) corpo.appendChild(h("div", { class: "barra" }, h("button", { class: "btn sec mini", type: "button", onclick: function () {
      acao(api("POST", "/pedidos/" + p.id + "/revisao"), "Alerta conferido.").then(function (n) { desenharDetalhe(n, corpo, fechar, dlg); }).catch(function () {}); } }, "Já conferi")));

    corpo.appendChild(h("h2", null, "Cliente"));
    corpo.appendChild(h("p", null, c.nome, h("br"), c.email, h("br"), fmtTel(c.telefone) + " · ", h("a", { href: "https://wa.me/55" + c.telefone, target: "_blank", rel: "noopener" }, "abrir no WhatsApp"), h("br"), "CPF " + fmtCpf(c.cpf)));
    corpo.appendChild(h("h2", null, "Entrega"));
    corpo.appendChild(h("p", { class: "endereco" }, textoEnd));
    corpo.appendChild(h("div", { class: "barra" }, h("button", { class: "btn sec mini", type: "button", onclick: function () { copiar(textoEnd); } }, "Copiar endereço")));

    corpo.appendChild(h("h2", null, "Itens"));
    p.itens.forEach(function (i) { corpo.appendChild(h("div", { class: "linha-ped" }, h("span", null, i.qtd + "× " + i.nome + (i.promocao ? " (promoção)" : "")), h("span", null, reais(i.unitario * i.qtd)))); });
    corpo.appendChild(h("div", { class: "linha-ped" }, h("span", null, "Subtotal"), h("span", null, reais(p.subtotal))));
    if (p.desconto > 0) corpo.appendChild(h("div", { class: "linha-ped" }, h("span", null, "Desconto" + (p.cupom ? " (" + p.cupom + ")" : "")), h("span", null, "− " + reais(p.desconto))));
    corpo.appendChild(h("div", { class: "linha-ped" }, h("span", null, "Frete"), h("span", null, reais(p.frete))));
    corpo.appendChild(h("div", { class: "linha-ped total" }, h("span", null, "Total"), h("span", null, reais(p.total))));

    if (proximos.length) {
      corpo.appendChild(h("h2", null, "Próximo passo"));
      if (proximos.indexOf("enviado") >= 0) corpo.appendChild(h("div", null, h("label", null, "Código de rastreio (obrigatório para marcar como enviado)"), rastreio));
      corpo.appendChild(h("div", { class: "barra" }, proximos.map(function (n) {
        return h("button", { class: "btn mini" + (n === "cancelado" || n === "reembolsado" ? " perigo" : n === "enviado" || n === "em_producao" || n === "entregue" ? "" : " sec"), type: "button", onclick: function () { mudar(n); } }, ROTULO_ACAO[n]);
      })));
    } else if (p.rastreio) corpo.appendChild(h("p", null, "Rastreio: " + p.rastreio));

    corpo.appendChild(h("h2", null, "Link de acompanhamento do cliente"));
    corpo.appendChild(h("div", { class: "barra" }, h("input", { type: "text", readonly: true, value: link, "aria-label": "Link de acompanhamento" }), h("button", { class: "btn sec mini", type: "button", onclick: function () { copiar(link); } }, "Copiar")));
    corpo.appendChild(h("h2", null, "Histórico"));
    p.eventos.forEach(function (ev) { corpo.appendChild(h("div", { class: "meta" }, dataHora(ev.quando) + " · " + (EVENTO_TXT[ev.tipo] || ev.tipo) + (ev.detalhe ? " (" + ev.detalhe + ")" : ""))); });
    corpo.appendChild(h("div", { class: "barra" }, h("button", { class: "btn sec", type: "button", onclick: function () { fechar(); recarregar(); } }, "Fechar")));
  }

  /* ========== CUPONS ========== */
  var SITUACAO = { ativo: ["Ativo", ""], esgotado: ["Esgotado", "vermelha"], expirado: ["Expirado", "cinza"], desativado: ["Desativado", "cinza"], agendado: ["Agendado", ""] };
  function dataBR(d) { return d ? d.split("-").reverse().join("/") : ""; }
  function resumoCupom(c) {
    var desc = c.tipo === "percentual" ? c.valor + "% de desconto" : c.tipo === "valor" ? reais(c.valor) + " de desconto" : "Frete grátis";
    var partes = [desc, c.usos_ativos + (c.limite_total ? "/" + c.limite_total : "") + " usos"];
    if (c.so_primeira_compra) partes.push("primeira compra");
    if (c.fim) partes.push("até " + dataBR(c.fim));
    return partes.join(" · ");
  }

  function abaCupons(main) {
    main.appendChild(h("h1", null, "Cupons de desconto"));
    main.appendChild(h("p", { class: "dica" }, "Cada cupom vale uma vez por CPF, não se soma a outro cupom no mesmo pedido, e o desconto é calculado pelo servidor. Quando o limite de usos acaba, o cupom fica “Esgotado” sozinho. Os cupons valem no fechamento da compra, quando o pagamento online estiver ativo."));
    main.appendChild(h("div", { class: "barra" }, h("span", { class: "espaco" }), h("button", { class: "btn", onclick: function () { formCupom(null); } }, "+ Novo cupom")));
    if (!S.cupons.length) main.appendChild(h("p", { class: "vazio" }, "Nenhum cupom ainda."));
    S.cupons.forEach(function (c) {
      var sit = SITUACAO[c.situacao] || [c.situacao, "cinza"];
      main.appendChild(h("div", { class: "cartao" }, h("div", { class: "linha cupom" },
        h("div", { class: "miniatura sigla" }, "%"),
        h("div", null, h("div", { class: "nome" }, c.codigo, h("span", { class: "etq " + sit[1] }, sit[0])), h("div", { class: "meta" }, resumoCupom(c))),
        h("div", { class: "acoes extra" },
          h("button", { class: "btn sec mini", onclick: function () { usosCupom(c); } }, "Usos"),
          h("button", { class: "btn sec mini", onclick: function () {
            acao(api("PATCH", "/cupons/" + c.id, { ativo: !c.ativo }), c.ativo ? "Cupom desativado." : "Cupom ativado.").then(recarregar).catch(function () {});
          } }, c.ativo ? "Desativar" : "Ativar"),
          h("button", { class: "btn sec mini", onclick: function () { formCupom(c); } }, "Editar")))));
    });
  }

  function dialogo(conteudo) {
    var dlg = h("dialog");
    dlg.appendChild(conteudo(dlg));
    dlg.addEventListener("close", function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  function usosCupom(c) {
    var corpo = h("div", null, h("p", { class: "dica" }, "Carregando…"));
    dialogo(function (dlg) {
      return h("form", { method: "dialog" }, h("h2", null, "Usos do cupom " + c.codigo),
        h("p", { class: "dica" }, "Por privacidade, o painel não mostra CPF nem e-mail."), corpo,
        h("div", { class: "barra" }, h("button", { class: "btn sec", type: "button", onclick: function () { dlg.close(); } }, "Fechar")));
    });
    api("GET", "/cupons/" + c.id + "/usos").then(function (usos) {
      limpar(corpo);
      if (!usos.length) { corpo.appendChild(h("p", { class: "vazio" }, "Ainda sem usos.")); return; }
      var ROT = { reservado: "Aguardando pagamento", consumido: "Pago", liberado: "Liberado (não pago)" };
      usos.forEach(function (u) { corpo.appendChild(h("div", { class: "cartao" }, h("b", null, ROT[u.situacao] || u.situacao), " · pedido " + u.pedido + " · " + reais(u.desconto) + " · " + u.quando)); });
    }).catch(function (e) { limpar(corpo); corpo.appendChild(h("p", { class: "erro" }, e.message)); });
  }

  function formCupom(c) {
    var novo = !c;
    var d = c || { codigo: "", tipo: "percentual", valor: 10, limite_total: null, so_primeira_compra: false, valor_minimo: null, inicio: "", fim: "", escopo: "todos", escopo_ids: [], acumula_promocao: false, ativo: true };
    var f = {
      codigo: h("input", { type: "text", maxlength: "20", required: true, value: d.codigo, placeholder: "Ex.: BEMVINDO10", disabled: !novo && c.usos_ativos + c.usos_pagos > 0 }),
      tipo: h("select", null, [["percentual", "Porcentagem (%)"], ["valor", "Valor em reais (R$)"], ["frete", "Frete grátis"]].map(function (x) { return h("option", { value: x[0], selected: x[0] === d.tipo }, x[1]); })),
      valor: h("input", { type: "text", inputmode: "decimal", value: d.tipo === "valor" ? Number(d.valor).toFixed(2).replace(".", ",") : String(d.valor || "") }),
      limite: h("input", { type: "number", min: "1", value: d.limite_total || "", placeholder: "Vazio = sem limite" }),
      minimo: h("input", { type: "text", inputmode: "decimal", value: d.valor_minimo ? Number(d.valor_minimo).toFixed(2).replace(".", ",") : "", placeholder: "Opcional" }),
      inicio: h("input", { type: "date", value: d.inicio || "" }), fim: h("input", { type: "date", value: d.fim || "" }),
      escopo: h("select", null, [["todos", "Todos os produtos"], ["categorias", "Só algumas categorias"], ["produtos", "Só alguns produtos"]].map(function (x) { return h("option", { value: x[0], selected: x[0] === d.escopo }, x[1]); })),
      primeira: h("input", { type: "checkbox", checked: d.so_primeira_compra }),
      acumula: h("input", { type: "checkbox", checked: d.acumula_promocao }),
      ativo: h("input", { type: "checkbox", checked: d.ativo })
    };
    var escolhidos = {}; (d.escopo_ids || []).forEach(function (i) { escolhidos[i] = true; });
    var lista = h("div", { class: "lista-escopo" });
    function rotuloValor() { return f.tipo.value === "percentual" ? "Desconto (%)" : f.tipo.value === "valor" ? "Desconto (R$)" : "—"; }
    var rotV = h("label", null, rotuloValor());
    function mostrarEscopo() {
      limpar(lista);
      var fonte = f.escopo.value === "categorias" ? S.categorias : f.escopo.value === "produtos" ? S.produtos : [];
      fonte.forEach(function (x) {
        var cb = h("input", { type: "checkbox", checked: !!escolhidos[x.id], onchange: function () { escolhidos[x.id] = cb.checked; } });
        lista.appendChild(h("label", { class: "chk" }, cb, x.nome));
      });
    }
    f.escopo.addEventListener("change", function () { escolhidos = {}; mostrarEscopo(); });
    f.tipo.addEventListener("change", function () { rotV.textContent = rotuloValor(); f.valor.disabled = f.tipo.value === "frete"; });
    f.valor.disabled = d.tipo === "frete";
    mostrarEscopo();

    function campo(r, el, dica) { return h("div", null, h("label", null, r), el, dica ? h("p", { class: "dica" }, dica) : null); }
    dialogo(function (dlg) {
      return h("form", { method: "dialog", onsubmit: function (ev) {
        ev.preventDefault();
        var corpo = {
          codigo: f.codigo.value, tipo: f.tipo.value, valor: f.tipo.value === "frete" ? 0 : lerReais(f.valor.value),
          limite_total: f.limite.value ? Number(f.limite.value) : null, valor_minimo: f.minimo.value.trim() ? lerReais(f.minimo.value) : null,
          inicio: f.inicio.value || null, fim: f.fim.value || null, escopo: f.escopo.value,
          escopo_ids: Object.keys(escolhidos).filter(function (k) { return escolhidos[k]; }),
          so_primeira_compra: f.primeira.checked, acumula_promocao: f.acumula.checked, ativo: f.ativo.checked
        };
        if (c && f.codigo.disabled) delete corpo.codigo;
        acao(novo ? api("POST", "/cupons", corpo) : api("PUT", "/cupons/" + c.id, corpo), "Cupom salvo.").then(function () { dlg.close(); return recarregar(); }).catch(function () {});
      } },
        h("h2", null, novo ? "Novo cupom" : "Editar cupom"),
        campo("Código", f.codigo, f.codigo.disabled ? "Este cupom já foi usado, então o código não muda." : "O cliente digita este código. Letras e números, sem espaço."),
        h("div", { class: "grade3" }, campo("Tipo", f.tipo), h("div", null, rotV, f.valor), campo("Limite de usos", f.limite, "Ex.: 10. Ao acabar, fica esgotado.")),
        h("div", { class: "grade3" }, campo("Pedido mínimo (R$)", f.minimo, "Soma dos itens que o cupom alcança."), campo("Vale a partir de", f.inicio), campo("Vale até (inclusive)", f.fim)),
        campo("Onde vale", f.escopo), lista,
        h("label", { class: "chk" }, f.primeira, "Só para a primeira compra (vale se o CPF ainda não comprou nada na loja)"),
        h("label", { class: "chk" }, f.acumula, "Também vale sobre produtos já em promoção"),
        h("label", { class: "chk" }, f.ativo, "Cupom ativo"),
        h("div", { class: "barra" },
          h("button", { class: "btn", type: "submit" }, "Salvar"),
          h("button", { class: "btn sec", type: "button", onclick: function () { dlg.close(); } }, "Cancelar"),
          h("span", { class: "espaco" }),
          novo ? null : h("button", { class: "btn perigo", type: "button", onclick: function () {
            if (!confirm("Excluir o cupom " + c.codigo + "?")) return;
            acao(api("DELETE", "/cupons/" + c.id), "Cupom excluído.").then(function () { dlg.close(); return recarregar(); }).catch(function () {});
          } }, "Excluir")));
    });
  }

  /* ========== TEXTOS E CONTATO ========== */
  var ICONES = [["mao", "Coração"], ["cartao", "Cartão"], ["caixa", "Caixa"], ["zap", "Conversa"]];

  function abaTextos(main) {
    var c = S.config;
    var qs = c.quem_somos || { titulo: "", textos: [], imagem_id: null };
    var estado = { logo_id: c.logo_id || null, quem_imagem: qs.imagem_id || null, depoimentos: (c.depoimentos || []).map(function (d) { return { nome: d.nome, texto: d.texto }; }) };

    var f = {
      loja: h("input", { type: "text", maxlength: "40", value: c.loja || "" }),
      slogan: h("input", { type: "text", maxlength: "80", value: c.slogan || "" }),
      whatsapp: h("input", { type: "text", inputmode: "numeric", value: c.whatsapp || "" }),
      instagram: h("input", { type: "text", maxlength: "30", value: c.instagram || "" }),
      email: h("input", { type: "text", maxlength: "120", value: c.email || "" }),
      dias: h("input", { type: "number", min: "0", max: "60", value: c.prazo_producao_dias_uteis }),
      frete: h("input", { type: "text", inputmode: "decimal", value: c.frete_provisorio ? Number(c.frete_provisorio).toFixed(2).replace(".", ",") : "0,00" }),
      aviso: h("textarea", { maxlength: "400" }),
      faixa: h("textarea", { maxlength: "520" }),
      qsTitulo: h("input", { type: "text", maxlength: "60", value: qs.titulo || "" }),
      qsTextos: h("textarea", { maxlength: "4000" })
    };
    f.aviso.value = c.aviso_prazo || "";
    f.faixa.value = (c.faixa_avisos || []).join("\n");
    f.qsTextos.value = (qs.textos || []).join("\n\n");

    var ben = [0, 1, 2, 3].map(function (i) {
      var b = (c.beneficios || [])[i] || { icone: ICONES[i][0], titulo: "", texto: "" };
      return {
        icone: h("select", { "aria-label": "Ícone" }, ICONES.map(function (x) { return h("option", { value: x[0], selected: x[0] === b.icone }, x[1]); })),
        titulo: h("input", { type: "text", maxlength: "40", value: b.titulo, placeholder: "Título (deixe vazio para não mostrar)" }),
        texto: h("input", { type: "text", maxlength: "80", value: b.texto, placeholder: "Texto curto" })
      };
    });

    function blocoImagem(rotulo, pegar, definir, maxLado) {
      var area = h("div", { class: "barra" });
      function mostrar() {
        limpar(area);
        var id = pegar();
        area.appendChild(id ? h("img", { class: "miniatura", src: foto(id), alt: "" }) : h("span", { class: "dica" }, "Sem imagem."));
        area.appendChild(seletorFotos(id ? "Trocar" : "Escolher imagem", false, maxLado, function (ids) { definir(ids[0]); mostrar(); }));
        if (id) area.appendChild(h("button", { class: "btn perigo mini", type: "button", onclick: function () { definir(null); mostrar(); } }, "Remover"));
      }
      mostrar();
      return h("div", null, h("label", null, rotulo), area);
    }

    var depBox = h("div");
    function mostrarDeps() {
      limpar(depBox);
      if (!estado.depoimentos.length) depBox.appendChild(h("p", { class: "dica" }, "Nenhum depoimento. A seção só aparece na loja quando houver pelo menos um."));
      estado.depoimentos.forEach(function (d, i) {
        var nome = h("input", { type: "text", maxlength: "40", value: d.nome, placeholder: "Nome do cliente", "aria-label": "Nome do cliente" });
        var txt = h("textarea", { maxlength: "400", "aria-label": "Depoimento" }); txt.value = d.texto;
        nome.addEventListener("input", function () { d.nome = nome.value; });
        txt.addEventListener("input", function () { d.texto = txt.value; });
        depBox.appendChild(h("div", { class: "cartao" }, nome, h("div", null, txt),
          h("div", { class: "barra" }, h("button", { class: "btn perigo mini", type: "button", onclick: function () { estado.depoimentos.splice(i, 1); mostrarDeps(); } }, "Remover"))));
      });
    }
    mostrarDeps();

    function secao(titulo, dica) { return [h("h2", null, titulo), dica ? h("p", { class: "dica" }, dica) : null]; }
    function campo(r, el, dica) { return h("div", null, h("label", null, r), el, dica ? h("p", { class: "dica" }, dica) : null); }

    main.appendChild(h("h1", null, "Textos e contato"));
    main.appendChild(h("form", { onsubmit: function (ev) {
      ev.preventDefault();
      var corpo = {
        loja: f.loja.value, slogan: f.slogan.value, whatsapp: f.whatsapp.value, instagram: f.instagram.value, email: f.email.value,
        prazo_producao_dias_uteis: Number(f.dias.value), frete_provisorio: lerReais(f.frete.value || "0"), aviso_prazo: f.aviso.value,
        faixa_avisos: f.faixa.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean),
        beneficios: ben.filter(function (b) { return b.titulo.value.trim(); }).map(function (b) { return { icone: b.icone.value, titulo: b.titulo.value, texto: b.texto.value }; }),
        quem_somos: { titulo: f.qsTitulo.value, textos: f.qsTextos.value.split(/\n\s*\n/).map(function (x) { return x.trim(); }).filter(Boolean), imagem_id: estado.quem_imagem },
        depoimentos: estado.depoimentos.filter(function (d) { return d.nome.trim() || d.texto.trim(); }),
        logo_id: estado.logo_id
      };
      acao(api("PUT", "/config", corpo), "Textos salvos.").then(recarregar).catch(function () {});
    } },
      secao("Marca"),
      h("div", { class: "grade2" }, campo("Nome da loja", f.loja), campo("Frase da loja", f.slogan)),
      blocoImagem("Logo (substitui o nome escrito no topo)", function () { return estado.logo_id; }, function (id) { estado.logo_id = id; }, 600),
      secao("Contato"),
      h("div", { class: "grade3" }, campo("WhatsApp", f.whatsapp, "Com 55 e DDD, só números."), campo("Instagram", f.instagram, "Só o usuário, sem @."), campo("E-mail", f.email)),
      secao("Prazo de entrega"),
      h("div", { class: "grade2" }, campo("Dias úteis de produção", f.dias, "Usado na página Prazos e Envio."), campo("Frete provisório (R$)", f.frete, "Valor fixo cobrado em todo pedido até o cálculo por CEP (Fase 4). Cupom de frete grátis zera.")),
      campo("Aviso de prazo", f.aviso, "Aparece na vitrine, no produto e no carrinho."),
      secao("Faixa de avisos do topo", "Uma frase por linha (até 5). Se houver mais de uma, elas se alternam."),
      f.faixa,
      secao("Benefícios", "Os ícones abaixo da primeira imagem (até 4). Deixe o título vazio para esconder."),
      ben.map(function (b) { return h("div", { class: "cartao" }, h("div", { class: "grade3" }, b.icone, b.titulo, b.texto)); }),
      secao("Quem somos", "Separe os parágrafos com uma linha em branco."),
      campo("Título", f.qsTitulo), campo("Texto", f.qsTextos),
      blocoImagem("Foto", function () { return estado.quem_imagem; }, function (id) { estado.quem_imagem = id; }, 1000),
      secao("Depoimentos", "Use só depoimentos reais de clientes."),
      depBox,
      h("button", { class: "btn sec mini", type: "button", onclick: function () { if (estado.depoimentos.length < 12) { estado.depoimentos.push({ nome: "", texto: "" }); mostrarDeps(); } } }, "+ Adicionar depoimento"),
      h("div", { class: "barra" }, h("button", { class: "btn", type: "submit" }, "Salvar textos"))));
  }

  /* ---------- início ---------- */
  api("GET", "/sessao").then(iniciar).catch(function (e) { if (e.message !== "sessão") telaLogin(); });
})();
