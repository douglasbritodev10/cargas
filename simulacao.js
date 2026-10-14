import { db, collection, getDocs, doc, getDoc } from './firebase.js';

let produtosDisponiveisCache = [];

async function carregarSelectsSimulacao() {
  const prodsSnap = await getDocs(collection(db, "produtos"));
  produtosDisponiveisCache = [];
  prodsSnap.forEach(d => {
    produtosDisponiveisCache.push({ id: d.id, ...d.data() });
  });

  const selVeic = document.getElementById('sim-veiculo');
  if (selVeic) {
    selVeic.innerHTML = '';
    const veics = await getDocs(collection(db, "veiculos"));
    veics.forEach(d => {
      selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome}</option>`;
    });
  }

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
    
    // Pega a primeira norma cadastrada do produto para cálculo de palete padrão
    const normaRef = prodObj.normasPaletizacao && prodObj.normasPaletizacao.length > 0 ? prodObj.normasPaletizacao[0] : { unificador: 'PALETE 1.60 X 1.60', jogosPorPalete: 10 };
    const jogosPorPaleteNorma = normaRef.jogosPorPalete || 10;
    
    const paletesCompletos = Math.floor(qtdJogos / jogosPorPaleteNorma);
    const jogosRestantes = qtdJogos % jogosPorPaleteNorma;
    const totalPaletesNecessarios = paletesCompletos + (jogosRestantes > 0 ? 1 : 0);

    pesoTotalCargaGeral += pesoTotalProd;
    totalJogosGeral += qtdJogos;

    resumoPaletesHtml += `
      <div style="margin-bottom: 8px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 6px;">
        <strong>${prodObj.codigo} - ${prodObj.descricao} (Grade: ${prodObj.grade || 'Padrão'})</strong><br>
        • Solicitado: <strong>${qtdJogos} Jogos</strong> (${prodObj.volumes.length} volumes cada)<br>
        • Norma WMS: <strong>${normaRef.unificador}</strong> (${jogosPorPaleteNorma} jogos/palete)<br>
        • <strong>Desmembramento Inteligente:</strong> ${paletesCompletos} palete(s) fechado(s) + ${jogosRestantes > 0 ? `1 palete fracionado/sobra com ${jogosRestantes} jogos` : 'Nenhum fracionado'}. (Total: <strong>${totalPaletesNecessarios} Paletes</strong>)
      </div>
    `;

    itensSimulacao.push({ produto: prodObj, qtdJogos, normaRef });
  }

  if (itensSimulacao.length === 0) return alert("Selecione produtos válidos e informe quantidades maiores que zero!");

  document.getElementById('relatorio-impressao').classList.remove('hidden');

  document.getElementById('sim-resumo').innerHTML = `
    <strong>Veículo Selecionado:</strong> ${veiculo.nome} (${veiculo.tipo}) - Cáp: ${veiculo.comprimento}m C x ${veiculo.largura}m L x ${veiculo.altura}m A<br>
    <strong>Total de Jogos na Carga:</strong> ${totalJogosGeral} Jogos | <strong>Peso Total Estimado:</strong> ${pesoTotalCargaGeral.toFixed(1)} kg
  `;

  document.getElementById('sim-paletes-desmembramento').innerHTML = resumoPaletesHtml;

  desenharPalete(itensSimulacao[0].normaRef);
  desenharCargaMultipla(itensSimulacao, veiculo);
  gerarInstrucoesTextoMultipla(itensSimulacao, veiculo);
};

function desenharPalete(norma) {
  const canvas = document.getElementById('canvas-palete');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#b45309";
  ctx.fillRect(100, 240, 200, 20);
  ctx.fillStyle = "#78350f";
  ctx.fillRect(120, 260, 30, 15);
  ctx.fillRect(185, 260, 30, 15);
  ctx.fillRect(250, 260, 30, 15);

  const camadas = norma.camadas || 4;
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
  ctx.fillText(`Norma: ${norma.unificador} | ${norma.jogosPorPalete} jogos/palete`, 60, 25);
}

function desenharCargaMultipla(itens, veiculo) {
  const cvTop = document.getElementById('canvas-carga-top');
  const ctxT = cvTop.getContext('2d');
  const cvSide = document.getElementById('canvas-carga-side');
  const ctxS = cvSide.getContext('2d');

  ctxT.clearRect(0, 0, cvTop.width, cvTop.height);
  ctxS.clearRect(0, 0, cvSide.width, cvSide.height);

  const isSider = veiculo.tipo === "Sider";
  
  document.getElementById('desc-estrategia').innerHTML = isSider
    ? `<strong>Estratégia Sider:</strong> Blocos de jogos dispostos ao longo da lateral para acesso rápido por lona.`
    : `<strong>Estratégia Baú:</strong> Carga organizada do fundo para a porta traseira em fileiras sequenciais.`;

  [ctxT, ctxS].forEach(ctx => {
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(40, 30, 670, 140);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 2;
    ctx.strokeRect(40, 30, 670, 140);

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
      <li><strong>SEPARAÇÃO RIGOROSA POR GRADE E CÓDIGO:</strong> Proibido misturar volumes de códigos ou variações diferentes no mesmo bloco.</li>
      <li><strong>INTEGRIDADE DOS VOLUMES:</strong> Cada jogo deve manter todos os seus volumes reunidos conforme norma do WMS.</li>
  `;

  itens.forEach(item => {
    html += `
      <li><strong>Produto ${item.produto.codigo} - ${item.produto.descricao} (Grade: ${item.produto.grade || 'N/A'}):</strong>
        <ul>
          <li>Quantidade solicitada: ${item.qtdJogos} jogos (${item.produto.volumes.length} volumes por jogo).</li>
          <li>Norma WMS associada: ${item.normaRef.unificador}</li>
        </ul>
      </li>
    `;
  });

  html += `</ul>`;
  container.innerHTML = html;
}

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

carregarSelectsSimulacao();