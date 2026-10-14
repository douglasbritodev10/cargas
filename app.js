import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc } from './firebase.js';

let volumeCount = 0;
let produtosDisponiveisCache = [];

// Navegação por abas
window.switchTab = function(tabName) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(`tab-${tabName}`).classList.add('active');
  event.target.classList.add('active');

  if (tabName === 'produtos') carregarProdutos();
  if (tabName === 'veiculos') carregarVeiculos();
  if (tabName === 'simulacao') carregarSelectsSimulacao();
};

// --- CADASTRO DE PRODUTOS E VOLUMES ---
window.addVolumeField = function(vol = {}) {
  volumeCount++;
  const container = document.getElementById('volumes-container');
  const div = document.createElement('div');
  div.className = 'volume-row';
  div.id = `vol-row-${volumeCount}`;
  div.innerHTML = `
    <input type="text" placeholder="Ex: 01/03" value="${vol.numero || '0' + volumeCount + '/03'}" class="vol-num" required>
    <input type="text" placeholder="Desc. (Ex: Lateral/Porta)" value="${vol.descricao || ''}" class="vol-desc" required>
    <input type="number" step="0.01" placeholder="Alt(m)" value="${vol.altura || ''}" class="vol-alt" oninput="calcularNormaAuto()" required>
    <input type="number" step="0.01" placeholder="Larg(m)" value="${vol.largura || ''}" class="vol-larg" required>
    <input type="number" step="0.01" placeholder="Prof(m)" value="${vol.prof || ''}" class="vol-prof" required>
    <input type="number" step="0.1" placeholder="Peso(kg)" value="${vol.peso || ''}" class="vol-peso" oninput="calcularNormaAuto()" required>
    <button type="button" class="btn-remove" onclick="removeVolumeField(${volumeCount})">X</button>
  `;
  container.appendChild(div);
};

window.removeVolumeField = function(id) {
  const row = document.getElementById(`vol-row-${id}`);
  if (row) row.remove();
  calcularNormaAuto();
};

window.calcularNormaAuto = function() {
  const camadas = parseFloat(document.getElementById('norma-camadas').value) || 0;
  let pesoTotalJogo = 0;
  let maiorAlturaVol = 0;

  document.querySelectorAll('.volume-row').forEach(row => {
    const peso = parseFloat(row.querySelector('.vol-peso').value) || 0;
    const alt = parseFloat(row.querySelector('.vol-alt').value) || 0;
    pesoTotalJogo += peso;
    if (alt > maiorAlturaVol) maiorAlturaVol = alt;
  });

  const alturaFinalEstimada = (maiorAlturaVol * camadas) + 0.15; // +15cm do palete de madeira

  document.getElementById('norma-calculo-auto').innerHTML = 
    `Calculado p/ 1 Jogo: Peso Carga = <strong>${pesoTotalJogo.toFixed(1)} kg</strong> | Altura Est. Palete = <strong>${alturaFinalEstimada.toFixed(2)} m</strong>`;
};

document.getElementById('form-produto').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const volumes = [];
  document.querySelectorAll('.volume-row').forEach(row => {
    volumes.push({
      numero: row.querySelector('.vol-num').value,
      descricao: row.querySelector('.vol-desc').value,
      altura: parseFloat(row.querySelector('.vol-alt').value),
      largura: parseFloat(row.querySelector('.vol-larg').value),
      prof: parseFloat(row.querySelector('.vol-prof').value),
      peso: parseFloat(row.querySelector('.vol-peso').value)
    });
  });

  const produtoData = {
    codigo: document.getElementById('prod-codigo').value,
    descricao: document.getElementById('prod-descricao').value,
    grade: document.getElementById('prod-grade').value,
    fornecedor: document.getElementById('prod-fornecedor').value,
    volumes: volumes,
    norma: {
      dimensao: document.getElementById('norma-dimensao').value,
      lastro: parseInt(document.getElementById('norma-lastro').value),
      camadas: parseInt(document.getElementById('norma-camadas').value),
      jogosPorPalete: parseInt(document.getElementById('norma-jogos').value)
    }
  };

  const id = document.getElementById('prod-id').value;
  if (id) {
    await updateDoc(doc(db, "produtos", id), produtoData);
    alert("Produto atualizado com sucesso!");
  } else {
    await addDoc(collection(db, "produtos"), produtoData);
    alert("Produto cadastrado com sucesso!");
  }

  resetFormProduto();
  carregarProdutos();
});

window.resetFormProduto = function() {
  document.getElementById('form-produto').reset();
  document.getElementById('prod-id').value = '';
  document.getElementById('volumes-container').innerHTML = '';
  volumeCount = 0;
  addVolumeField();
};

async function carregarProdutos() {
  const tbody = document.getElementById('lista-produtos');
  tbody.innerHTML = '';
  const querySnapshot = await getDocs(collection(db, "produtos"));
  querySnapshot.forEach((docSnap) => {
    const p = docSnap.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.codigo}</td>
      <td>${p.descricao}</td>
      <td>${p.grade || '-'}</td>
      <td>${p.fornecedor}</td>
      <td>${p.volumes ? p.volumes.length : 0} vol(s)</td>
      <td>
        <button class="btn-secondary" onclick="editarProduto('${docSnap.id}')">Editar</button>
        <button class="btn-remove" style="padding:0 8px" onclick="deletarProduto('${docSnap.id}')">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.editarProduto = async function(id) {
  const docSnap = await getDoc(doc(db, "produtos", id));
  if (docSnap.exists()) {
    const p = docSnap.data();
    document.getElementById('prod-id').value = id;
    document.getElementById('prod-codigo').value = p.codigo;
    document.getElementById('prod-descricao').value = p.descricao;
    document.getElementById('prod-grade').value = p.grade;
    document.getElementById('prod-fornecedor').value = p.fornecedor;
    document.getElementById('norma-dimensao').value = p.norma.dimensao;
    document.getElementById('norma-lastro').value = p.norma.lastro;
    document.getElementById('norma-camadas').value = p.norma.camadas;
    document.getElementById('norma-jogos').value = p.norma.jogosPorPalete;

    document.getElementById('volumes-container').innerHTML = '';
    volumeCount = 0;
    if (p.volumes) {
      p.volumes.forEach(v => addVolumeField(v));
    }
    calcularNormaAuto();
  }
};

window.deletarProduto = async function(id) {
  if (confirm("Deseja realmente excluir este produto?")) {
    await deleteDoc(doc(db, "produtos", id));
    carregarProdutos();
  }
};

// --- CADASTRO DE VEÍCULOS ---
document.getElementById('form-veiculo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const veiculoData = {
    tipo: document.getElementById('veic-tipo').value,
    nome: document.getElementById('veic-nome').value,
    comprimento: parseFloat(document.getElementById('veic-comprimento').value),
    largura: parseFloat(document.getElementById('veic-largura').value),
    altura: parseFloat(document.getElementById('veic-altura').value)
  };

  const id = document.getElementById('veic-id').value;
  if (id) {
    await updateDoc(doc(db, "veiculos", id), veiculoData);
  } else {
    await addDoc(collection(db, "veiculos"), veiculoData);
  }

  document.getElementById('form-veiculo').reset();
  document.getElementById('veic-id').value = '';
  carregarVeiculos();
});

async function carregarVeiculos() {
  const tbody = document.getElementById('lista-veiculos');
  tbody.innerHTML = '';
  const querySnapshot = await getDocs(collection(db, "veiculos"));
  querySnapshot.forEach((docSnap) => {
    const v = docSnap.data();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${v.tipo}</strong></td>
      <td>${v.nome}</td>
      <td>${v.comprimento}m x ${v.largura}m x ${v.altura}m</td>
      <td>
        <button class="btn-remove" style="padding:0 8px" onclick="deletarVeiculo('${docSnap.id}')">Excluir</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.deletarVeiculo = async function(id) {
  if (confirm("Excluir veículo?")) {
    await deleteDoc(doc(db, "veiculos", id));
    carregarVeiculos();
  }
};

// --- SIMULAÇÃO INTELIGENTE COM MÚLTIPLOS PRODUTOS, GRADES E DESMEMBRAMENTO ---

async function carregarSelectsSimulacao() {
  const prodsSnap = await getDocs(collection(db, "produtos"));
  produtosDisponiveisCache = [];
  prodsSnap.forEach(d => {
    produtosDisponiveisCache.push({ id: d.id, ...d.data() });
  });

  const selVeic = document.getElementById('sim-veiculo');
  selVeic.innerHTML = '';
  const veics = await getDocs(collection(db, "veiculos"));
  veics.forEach(d => {
    selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome}</option>`;
  });

  // Limpa e adiciona a primeira linha de produto por padrão
  const container = document.getElementById('simulacao-produtos-container');
  if (container) {
    container.innerHTML = '';
    adicionarLinhaSimulacao();
  }
}

window.adicionarLinhaSimulacao = function() {
  const container = document.getElementById('simulacao-produtos-container');
  const linhaId = 'sim-prod-row-' + Date.now();
  
  const div = document.createElement('div');
  div.className = 'form-grid';
  div.style.marginBottom = '10px';
  div.id = linhaId;

  let optionsHtml = '<option value="">Selecione o Produto (Código - Descrição / Grade)</option>';
  produtosDisponiveisCache.forEach(p => {
    const gradeStr = p.grade ? ` | Grade: ${p.grade}` : ' | Sem Grade';
    optionsHtml += `<option value="${p.id}">${p.codigo} - ${p.descricao} ${gradeStr} (Fornecedor: ${p.fornecedor})</option>`;
  });

  div.innerHTML = `
    <div class="field" style="grid-column: span 3;">
      <label>Produto e Grade</label>
      <select class="sim-prod-select" required>${optionsHtml}</select>
    </div>
    <div class="field">
      <label>Qtd de Jogos (Kits)</label>
      <input type="number" class="sim-prod-qtd" value="10" min="1" required>
    </div>
    <div class="field" style="display: flex; align-items: flex-end;">
      <button type="button" class="btn-remove" onclick="document.getElementById('${linhaId}').remove()">Remover</button>
    </div>
  `;
  container.appendChild(div);
};

window.executarSimulacaoMultipla = async function() {
  const linhas = document.querySelectorAll('#simulacao-produtos-container > div');
  if (linhas.length === 0) return alert("Adicione pelo menos um produto à simulação!");

  const veicId = document.getElementById('sim-veiculo').value;
  if (!veicId) return alert("Selecione um veículo!");

  const veicSnap = await getDoc(doc(db, "veiculos", veicId));
  const veiculo = veicSnap.data();

  let itensSimulacao = [];
  let pesoTotalCargaGeral = 0;
  let totalJogosGeral = 0;
  let resumoPaletesHtml = "";

  for (let linha of linhas) {
    const prodId = linha.querySelector('.sim-prod-select').value;
    const qtdJogos = parseInt(linha.querySelector('.sim-prod-qtd').value) || 0;

    if (!prodId || qtdJogos <= 0) continue;

    const prodObj = produtosDisponiveisCache.find(p => p.id === prodId);
    if (!prodObj) continue;

    const pesoUmJogo = prodObj.volumes.reduce((acc, v) => acc + v.peso, 0);
    const pesoTotalProd = pesoUmJogo * qtdJogos;
    
    // Inteligência de Desmembramento de Paletes
    const jogosPorPaleteNorma = prodObj.norma.jogosPorPalete || 1;
    const paletesCompletos = Math.floor(qtdJogos / jogosPorPaleteNorma);
    const jogosRestantes = qtdJogos % jogosPorPaleteNorma;
    const totalPaletesNecessarios = paletesCompletos + (jogosRestantes > 0 ? 1 : 0);

    pesoTotalCargaGeral += pesoTotalProd;
    totalJogosGeral += qtdJogos;

    resumoPaletesHtml += `
      <div style="margin-bottom: 8px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 6px;">
        <strong>${prodObj.codigo} - ${prodObj.descricao} (Grade: ${prodObj.grade || 'Padrão'})</strong><br>
        • Solicitado: <strong>${qtdJogos} Jogos</strong> (${prodObj.volumes.length} volumes cada | Total de ${qtdJogos * prodObj.volumes.length} volumes soltos)<br>
        • Norma de Destino: <strong>${prodObj.norma.dimensao}</strong> (${jogosPorPaleteNorma} jogos/palete)<br>
        • <strong>Desmembramento Inteligente:</strong> ${paletesCompletos} palete(s) fechado(s) de ${jogosPorPaleteNorma} jogos + ${jogosRestantes > 0 ? `1 palete fracionado/desmembrado com ${jogosRestantes} jogos` : 'Nenhum palete fracionado'}. (Total: <strong>${totalPaletesNecessarios} Paletes</strong>)
      </div>
    `;

    itensSimulacao.push({ produto: prodObj, qtdJogos });
  }

  if (itensSimulacao.length === 0) return alert("Selecione produtos válidos e informe quantidades maiores que zero!");

  document.getElementById('relatorio-impressao').classList.remove('hidden');

  // Resumo Geral
  document.getElementById('sim-resumo').innerHTML = `
    <strong>Veículo Selecionado:</strong> ${veiculo.nome} (${veiculo.tipo}) - Cáp: ${veiculo.comprimento}m C x ${veiculo.largura}m L x ${veiculo.altura}m A<br>
    <strong>Total de Jogos na Carga:</strong> ${totalJogosGeral} Jogos | <strong>Peso Total Estimado:</strong> ${pesoTotalCargaGeral.toFixed(1)} kg
  `;

  document.getElementById('sim-paletes-desmembramento').innerHTML = resumoPaletesHtml;

  // Renderizar gráficos com base no primeiro produto da lista
  desenharPalete(itensSimulacao[0].produto);
  desenharCargaMultipla(itensSimulacao, veiculo);
  gerarInstrucoesTextoMultipla(itensSimulacao, veiculo);
};

// Canvas 1: Norma do Palete
function desenharPalete(produto) {
  const canvas = document.getElementById('canvas-palete');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fundo
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Base do Palete
  ctx.fillStyle = "#b45309";
  ctx.fillRect(100, 240, 200, 20); // Madeira
  ctx.fillStyle = "#78350f";
  ctx.fillRect(120, 260, 30, 15);
  ctx.fillRect(185, 260, 30, 15);
  ctx.fillRect(250, 260, 30, 15);

  // Desenhar Camadas de Caixas
  const camadas = produto.norma.camadas || 3;
  const alturaCaixa = 180 / camadas;

  for (let i = 0; i < camadas; i++) {
    const y = 240 - ((i + 1) * alturaCaixa);
    ctx.fillStyle = (i % 2 === 0) ? "#3b82f6" : "#60a5fa";
    ctx.fillRect(105, y, 190, alturaCaixa - 2);
    ctx.strokeStyle = "#1d4ed8";
    ctx.strokeRect(105, y, 190, alturaCaixa - 2);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "11px sans-serif";
    ctx.fillText(`Camada ${i + 1}`, 170, y + (alturaCaixa / 2) + 4);
  }

  ctx.fillStyle = "#0f172a";
  ctx.font = "bold 12px sans-serif";
  ctx.fillText(`Norma: ${produto.norma.dimensao} | ${produto.norma.jogosPorPalete} jogos/palete`, 80, 25);
}

// Canvas da Carga para Múltiplos Produtos
function desenharCargaMultipla(itens, veiculo) {
  const cvTop = document.getElementById('canvas-carga-top');
  const ctxT = cvTop.getContext('2d');
  const cvSide = document.getElementById('canvas-carga-side');
  const ctxS = cvSide.getContext('2d');

  ctxT.clearRect(0, 0, cvTop.width, cvTop.height);
  ctxS.clearRect(0, 0, cvSide.width, cvSide.height);

  const isSider = veiculo.tipo === "Sider";
  
  document.getElementById('desc-estrategia').innerHTML = isSider
    ? `<strong>Estratégia Sider (Múltiplos Itens/Grades):</strong> Os blocos de jogos de cada grade e produto são dispostos lado a lado ao longo da extensão da carreta. A abertura da lona permite o acesso lateral direto aos kits sem misturar grades diferentes.`
    : `<strong>Estratégia Baú (Múltiplos Itens/Grades):</strong> Os produtos são organizados do <strong>fundo para a porta traseira</strong> em fileiras estruturadas. Os itens que saem primeiro na rota ficam posicionados na porta traseira.`;

  // Moldura do Veículo
  [ctxT, ctxS].forEach(ctx => {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(40, 30, 670, 140);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 30, 670, 140);

    // Cabine
    ctx.fillStyle = "#94a3b8";
    ctx.fillRect(10, 30, 30, 140);
    ctx.fillStyle = "#0f172a";
    ctx.font = "10px sans-serif";
    ctx.fillText("CAB", 13, 100);
  });

  if (isSider) {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText("⬇ DESCARGA LATERAL (ABERTURA DE LONA) ⬇", 220, 20);
  } else {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText("PORTA TRASEIRA (INÍCIO DA DESCARGA) ➡", 470, 20);
  }

  let totalJogosGeral = itens.reduce((acc, item) => acc + item.qtdJogos, 0);
  let colunasMaximas = Math.min(totalJogosGeral, 15);
  let larguraBloco = 650 / colunasMaximas;
  let cursorX = 0;

  itens.forEach((item, indexColor) => {
    const cores = ["#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899"];
    const corAtual = cores[indexColor % cores.length];

    for (let j = 0; j < item.qtdJogos; j++) {
      if (cursorX >= colunasMaximas) break;
      const x = 45 + (cursorX * larguraBloco);

      ctxT.fillStyle = corAtual;
      ctxT.fillRect(x + 1, 35, larguraBloco - 2, 130);
      ctxT.strokeStyle = "#1e293b";
      ctxT.strokeRect(x + 1, 35, larguraBloco - 2, 130);

      ctxS.fillStyle = corAtual;
      ctxS.fillRect(x + 1, 35, larguraBloco - 2, 130);
      ctxS.strokeStyle = "#1e293b";
      ctxS.strokeRect(x + 1, 35, larguraBloco - 2, 130);

      cursorX++;
    }
  });
}

function gerarInstrucoesTextoMultipla(itens, veiculo) {
  const isSider = veiculo.tipo === "Sider";
  const container = document.getElementById('sim-instrucoes');

  let html = `
    <h4>REGRAS OBRIGATÓRIAS DE CARREGAMENTO E SEPARAÇÃO DE GRADES:</h4>
    <ul>
      <li><strong>SEPARAÇÃO RIGOROSA POR GRADE E CÓDIGO:</strong> Como a carga possui múltiplos itens/grades, é expressamente proibido misturar volumes de códigos ou variações diferentes no mesmo bloco de montagem.</li>
      <li><strong>INTEGRIDADE DOS VOLUMES:</strong> Cada jogo deve manter todos os seus volumes reunidos (respeitando a volumetria específica de cada produto cadastrado).</li>
  `;

  itens.forEach(item => {
    html += `
      <li><strong>Produto ${item.produto.codigo} - ${item.produto.descricao} (Grade: ${item.produto.grade || 'N/A'}):</strong>
        <ul>
          <li>Quantidade solicitada: ${item.qtdJogos} jogos (${item.produto.volumes.length} volumes por jogo).</li>
          <li>Composição dos volumes: ${item.produto.volumes.map(v => `Vol ${v.numero} (${v.descricao})`).join(', ')}.</li>
        </ul>
      </li>
    `;
  });

  if (isSider) {
    html += `<li><strong>Organização Sider:</strong> Alinhar os blocos por produto/grade ao longo da lateral para facilitar a retirada seletiva por lote de entrega.</li>`;
  } else {
    html += `<li><strong>Organização Baú:</strong> Empilhar do fundo para a porta, garantindo que os itens da última entrega fiquem acessíveis na porta traseira.</li>`;
  }

  html += `</ul>`;
  container.innerHTML = html;
}

// Exportar PDF
window.exportarPDF = function() {
  const { jsPDF } = window.jspdf;
  const element = document.getElementById('relatorio-impressao');
  
  document.querySelectorAll('.print-hide').forEach(el => el.style.display = 'none');

  html2canvas(element, { scale: 2 }).then(canvas => {
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`Instrucao_Carregamento_${Date.now()}.pdf`);

    document.querySelectorAll('.print-hide').forEach(el => el.style.display = 'flex');
  });
};

// Exportar Imagens PNG
window.exportarImagensPNG = function() {
  const canvases = ['canvas-palete', 'canvas-carga-top', 'canvas-carga-side'];
  canvases.forEach((id, index) => {
    const cv = document.getElementById(id);
    const link = document.createElement('a');
    link.download = `desenho_${id}_${index+1}.png`;
    link.href = cv.toDataURL('image/png');
    link.click();
  });
};

// Inicialização
carregarProdutos();