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
      selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome} (${d.data().comprimento}m C x ${d.data().largura}m L)</option>`;
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

    const volumesDoJogo = prodObj.volumes || [];
    if (volumesDoJogo.length === 0) {
      alert(`O produto ${prodObj.codigo} não possui volumes cadastrados!`);
      return;
    }

    // Calcula o peso e cubagem real de 1 jogo completo
    let pesoUmJogo = 0;
    volumesDoJogo.forEach(v => {
      pesoUmJogo += parseFloat(v.peso) || 0;
    });

    const pesoTotalProd = pesoUmJogo * qtdJogos;
    totalJogosGeral += qtdJogos;
    pesoTotalCargaGeral += pesoTotalProd;

    const normaRef = prodObj.normasPaletizacao && prodObj.normasPaletizacao.length > 0 ? prodObj.normasPaletizacao[0] : { unificador: 'PALETE 1.60 X 1.60', jogosPorPalete: 10 };
    const jogosPorPaleteNorma = normaRef.jogosPorPalete || 10;
    const paletesCompletos = Math.floor(qtdJogos / jogosPorPaleteNorma);
    const jogosRestantes = qtdJogos % jogosPorPaleteNorma;
    const totalPaletesNecessarios = paletesCompletos + (jogosRestantes > 0 ? 1 : 0);

    resumoPaletesHtml += `
      <div style="margin-bottom: 8px; border-bottom: 1px dashed #cbd5e1; padding-bottom: 6px;">
        <strong>${prodObj.codigo} - ${prodObj.descricao} (Grade: ${prodObj.grade || 'Padrão'})</strong><br>
        • Solicitado: <strong>${qtdJogos} Jogo(s)</strong> | Cada jogo é composto por <strong>${volumesDoJogo.length} volumes indivisíveis</strong>.<br>
        • Norma WMS Destino: <strong>${normaRef.unificador}</strong> (${jogosPorPaleteNorma} jogos/palete)<br>
        • <strong>Desmembramento:</strong> ${paletesCompletos} palete(s) fechado(s) + ${jogosRestantes > 0 ? `1 fracionado com ${jogosRestantes} jogos` : 'Nenhum fracionado'}. (Total: <strong>${totalPaletesNecessarios} Paletes</strong>)
      </div>
    `;

    itensSimulacao.push({ produto: prodObj, qtdJogos, volumesDoJogo, normaRef });
  }

  if (itensSimulacao.length === 0) return alert("Selecione produtos válidos!");

  document.getElementById('relatorio-impressao').classList.remove('hidden');

  document.getElementById('sim-resumo').innerHTML = `
    <strong>Veículo Selecionado:</strong> ${veiculo.nome} (${veiculo.tipo})<br>
    • Dimensões Úteis da Carroceria: <strong>Comprimento: ${veiculo.comprimento}m | Largura: ${veiculo.largura}m | Altura: ${veiculo.altura}m</strong><br>
    • Total de Jogos na Carga: <strong>${totalJogosGeral} Jogos</strong> | Peso Estimado: <strong>${pesoTotalCargaGeral.toFixed(1)} kg</strong>
  `;

  document.getElementById('sim-paletes-desmembramento').innerHTML = resumoPaletesHtml;

  desenharPalete(itensSimulacao[0].normaRef);
  desenharCargaRealPorBlocos(itensSimulacao, veiculo);
  gerarInstrucoesTextoReal(itensSimulacao, veiculo);
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

// MOTOR DE DESENHO INTELIGENTE: Respeita dimensões do veículo e mantém blocos de jogo unidos
function desenharCargaRealPorBlocos(itens, veiculo) {
  const cvTop = document.getElementById('canvas-carga-top');
  const ctxT = cvTop.getContext('2d');
  const cvSide = document.getElementById('canvas-carga-side');
  const ctxS = cvSide.getContext('2d');

  ctxT.clearRect(0, 0, cvTop.width, cvTop.height);
  ctxS.clearRect(0, 0, cvSide.width, cvSide.height);

  const isSider = veiculo.tipo === "Sider";
  
  document.getElementById('desc-estrategia').innerHTML = isSider
    ? `<strong>Estratégia Sider (${veiculo.comprimento}m de Comprimento):</strong> Os kits completos (com todos os volumes unidos em blocos sequenciais) são dispostos ao longo da lateral. A abertura da lona permite retirar o jogo inteiro sem fragmentação.`
    : `<strong>Estratégia Baú (${veiculo.comprimento}m de Comprimento):</strong> Os kits são organizados do <strong>fundo para a porta traseira</strong>. Cada jogo mantém seus volumes juntos, permitindo a descarga sequencial pelo fundo do baú.`;

  // Desenho da Carroceria proporcional ao comprimento real cadastrado
  [ctxT, ctxS].forEach(ctx => {
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(40, 25, 680, 150);
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 3;
    ctx.strokeRect(40, 25, 680, 150);

    // Cabine
    ctx.fillStyle = "#64748b";
    ctx.fillRect(5, 25, 35, 150);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 10px sans-serif";
    ctx.fillText("CAB", 10, 105);
  });

  if (isSider) {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText(`⬇ ABERTURA LATERAL - LONA SIDER (${veiculo.comprimento}m Úteis) ⬇`, 180, 18);
  } else {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText(`PORTA TRASEIRA DO BAÚ (${veiculo.comprimento}m Úteis) ➡`, 440, 18);
  }

  let totalJogosGeral = itens.reduce((acc, item) => acc + item.qtdJogos, 0);
  let maxColunasVisual = Math.min(Math.max(totalJogosGeral, 5), 16);
  let larguraDisponivel = 660;
  let cursorX = 0;

  itens.forEach((item, indexProduto) => {
    const coresGrad = ["#0284c7", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
    const corBase = coresGrad[indexProduto % coresGrad.length];
    const gradeNome = item.produto.grade ? ` - ${item.produto.grade}` : '';
    const volumesDoJogo = item.volumesDoJogo;

    for (let jogoIdx = 0; jogoIdx < item.qtdJogos; jogoIdx++) {
      if (cursorX >= maxColunasVisual) break;
      const blocoX = 45 + (cursorX * (larguraDisponivel / maxColunasVisual));
      const larguraBloco = (larguraDisponivel / maxColunasVisual) - 3;

      // Bloco Superior (Planta Baixa - Cada Jogo é um bloco fechado e unido)
      ctxT.fillStyle = corBase;
      ctxT.fillRect(blocoX, 30, larguraBloco, 140);
      ctxT.strokeStyle = "#0f172a";
      ctxT.lineWidth = 1.5;
      ctxT.strokeRect(blocoX, 30, larguraBloco, 140);

      ctxT.fillStyle = "#ffffff";
      ctxT.font = "bold 9px sans-serif";
      ctxT.fillText(`J${jogoIdx+1}: ${item.produto.codigo}${gradeNome}`, blocoX + 3, 44);

      // Listagem dos volumes dentro do bloco do jogo (Garante visualmente que estão juntos)
      let alturaVol = 120 / volumesDoJogo.length;
      volumesDoJogo.forEach((vol, vIdx) => {
        let volY = 48 + (vIdx * alturaVol);
        ctxT.strokeStyle = "rgba(255,255,255,0.6)";
        ctxT.strokeRect(blocoX + 2, volY, larguraBloco - 4, alturaVol - 2);
        
        ctxT.fillStyle = "#ffffff";
        ctxT.font = "8px sans-serif";
        ctxT.fillText(`${vol.numero} (${vol.descricao.substring(0, 10)})`, blocoX + 4, volY + (alturaVol / 2) + 3);
      });

      // Vista Lateral (Elevação)
      ctxS.fillStyle = corBase;
      ctxS.fillRect(blocoX, 30, larguraBloco, 140);
      ctxS.strokeStyle = "#0f172a";
      ctxS.strokeRect(blocoX, 30, larguraBloco, 140);

      ctxS.fillStyle = "#ffffff";
      ctxS.font = "bold 9px sans-serif";
      ctxS.fillText(`Jogo ${jogoIdx+1}`, blocoX + 3, 60);
      ctxS.font = "8px sans-serif";
      ctxS.fillText(`${item.produto.codigo}${gradeNome}`, blocoX + 3, 75);

      cursorX++;
    }
  });
}

function gerarInstrucoesTextoReal(itens, veiculo) {
  const isSider = veiculo.tipo === "Sider";
  const container = document.getElementById('sim-instrucoes');

  let html = `
    <h4>INSTRUÇÕES DE CARREGAMENTO INTELIGENTE (BLOCOS UNIFICADOS):</h4>
    <ul>
      <li><strong>INTEGRIDADE DO JOGO (BLOCO ÚNICO):</strong> É terminantemente proibido separar os volumes de um mesmo jogo. O conjunto completo (${item => item} volumes) deve ser acomodado lado a lado na carroceria, garantindo que o operador recolha o jogo inteiro de uma só vez.</li>
      <li><strong>RESPEITO ÀS DIMENSÕES DA CARROCERIA:</strong> Veículo ${veiculo.nome} (${veiculo.comprimento}m C x ${veiculo.largura}m L). Os volumes pesados e estruturais devem ir na base, enquanto volumes menores (como pés e fundos) e espelhos devem ser travados no miolo do respectivo bloco.</li>
  `;

  itens.forEach(item => {
    html += `
      <li><strong>Produto ${item.produto.codigo} - ${item.produto.descricao} (Grade: ${item.produto.grade || 'Padrão'}):</strong>
        <ul>
          <li>Qtd Solicitada: ${item.qtdJogos} Jogos | Composição de cada jogo: <strong>${item.volumesDoJogo.map(v => `${v.numero} (${v.descricao})`).join(' + ')}</strong>.</li>
          <li>Norma de Paletização no Destino: ${item.normaRef.unificador} (${item.normaRef.jogosPorPalete} jogos/palete).</li>
        </ul>
      </li>
    `;
  });

  if (isSider) {
    html += `<li><strong>Operação Sider:</strong> Alinhar os blocos completos longitudinalmente para descarga lateral limpa pela lona.</li>`;
  } else {
    html += `<li><strong>Operação Baú:</strong> Posicionar do fundo para a porta traseira, mantendo a sequência exata de entrega.</li>`;
  }

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