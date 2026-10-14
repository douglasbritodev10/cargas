import { db, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, getDoc } from './firebase.js';

let volumeCount = 0;

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

// --- SIMULAÇÃO DE CARREGAMENTO & DESENHO EM CANVAS ---
async function carregarSelectsSimulacao() {
  const selProd = document.getElementById('sim-produto');
  const selVeic = document.getElementById('sim-veiculo');
  selProd.innerHTML = '';
  selVeic.innerHTML = '';

  const prods = await getDocs(collection(db, "produtos"));
  prods.forEach(d => {
    selProd.innerHTML += `<option value="${d.id}">${d.data().codigo} - ${d.data().descricao}</option>`;
  });

  const veics = await getDocs(collection(db, "veiculos"));
  veics.forEach(d => {
    selVeic.innerHTML += `<option value="${d.id}">[${d.data().tipo}] ${d.data().nome}</option>`;
  });
}

window.executarSimulacao = async function() {
  const prodId = document.getElementById('sim-produto').value;
  const veicId = document.getElementById('sim-veiculo').value;
  const qtdJogos = parseInt(document.getElementById('sim-qtd').value);

  if (!prodId || !veicId) return alert("Cadastre e selecione produto e veículo!");

  const prodSnap = await getDoc(doc(db, "produtos", prodId));
  const veicSnap = await getDoc(doc(db, "veiculos", veicId));

  const produto = prodSnap.data();
  const veiculo = veicSnap.data();

  document.getElementById('relatorio-impressao').classList.remove('hidden');

  // Cálculo de pesos
  const pesoUmJogo = produto.volumes.reduce((acc, v) => acc + v.peso, 0);
  const pesoTotalCarga = pesoUmJogo * qtdJogos;
  const qtdPaletesNecessarios = Math.ceil(qtdJogos / produto.norma.jogosPorPalete);

  // Resumo
  document.getElementById('sim-resumo').innerHTML = `
    <strong>Produto:</strong> ${produto.codigo} - ${produto.descricao} (${produto.grade || 'S/G'})<br>
    <strong>Fornecedor:</strong> ${produto.fornecedor} | <strong>Qtd Solicitada:</strong> ${qtdJogos} Jogos (${qtdJogos * produto.volumes.length} volumes soltos)<br>
    <strong>Veículo Selecionado:</strong> ${veiculo.nome} (${veiculo.tipo}) - Cáp: ${veiculo.comprimento}m C x ${veiculo.largura}m L x ${veiculo.altura}m A<br>
    <strong>Estimativa Total:</strong> Peso Aprox: <strong>${pesoTotalCarga.toFixed(1)} kg</strong> | Paletes Gerados na Descarga: <strong>${qtdPaletesNecessarios} Paletes</strong> (${produto.norma.dimensao})
  `;

  // Renderizar Canvas
  desenharPalete(produto);
  desenharCarga(produto, veiculo, qtdJogos);

  // Gerar Instruções
  gerarInstrucoesTexto(produto, veiculo, qtdJogos);
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

// Canvas 2 e 3: Arranjo Inteligente da Carga por Jogos
function desenharCarga(produto, veiculo, qtdJogos) {
  const cvTop = document.getElementById('canvas-carga-top');
  const ctxT = cvTop.getContext('2d');
  const cvSide = document.getElementById('canvas-carga-side');
  const ctxS = cvSide.getContext('2d');

  ctxT.clearRect(0, 0, cvTop.width, cvTop.height);
  ctxS.clearRect(0, 0, cvSide.width, cvSide.height);

  const isSider = veiculo.tipo === "Sider";
  
  document.getElementById('desc-estrategia').innerHTML = isSider
    ? `<strong>Estratégia Sider (${qtdJogos} Jogos):</strong> Os jogos estão agrupados em blocos estruturados ao longo da lateral. Cada bloco contém todos os volumes (${produto.volumes.length} volumes) do mesmo jogo. Ao abrir a lona, a equipe remove os jogos lateralmente em ordem de rota ou lote.`
    : `<strong>Estratégia Baú (${qtdJogos} Jogos):</strong> Os jogos são dispostos em fileiras organizadas do <strong>fundo para a porta traseira</strong>. O Jogo 1 fica na posição de saída (porta), permitindo a descarga sequencial sem desarrumar o restante da carga.`;

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

  // Indicadores de Descarga
  if (isSider) {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText("⬇ DESCARGA LATERAL (ABERTURA DE LONA) ⬇", 220, 20);
  } else {
    ctxT.fillStyle = "#ef4444";
    ctxT.font = "bold 11px sans-serif";
    ctxT.fillText("PORTA TRASEIRA (INÍCIO DA DESCARGA) ➡", 470, 20);
  }

  // Desenho dos Blocos de Jogos de forma inteligente (máximo visual de 15 colunas/fileiras para caber bem)
  const colunasMaximas = Math.min(qtdJogos, 15);
  const larguraBloco = 650 / colunasMaximas;

  for (let i = 0; i < colunasMaximas; i++) {
    const x = 45 + (i * larguraBloco);
    const numJogoLabel = i + 1;

    // Vista Topo (Planta Baixa) - Agrupando os volumes do mesmo jogo
    ctxT.fillStyle = (i % 2 === 0) ? "#f59e0b" : "#fbbf24";
    ctxT.fillRect(x + 1, 35, larguraBloco - 2, 130);
    ctxT.strokeStyle = "#b45309";
    ctxT.strokeRect(x + 1, 35, larguraBloco - 2, 130);

    ctxT.fillStyle = "#0f172a";
    ctxT.font = "9px sans-serif";
    ctxT.fillText(`J${numJogoLabel}`, x + 3, 50);

    // Vista Lateral (Elevação)
    ctxS.fillStyle = (i % 2 === 0) ? "#10b981" : "#34d399";
    ctxS.fillRect(x + 1, 35, larguraBloco - 2, 130);
    ctxS.strokeStyle = "#047857";
    ctxS.strokeRect(x + 1, 35, larguraBloco - 2, 130);

    ctxS.fillStyle = "#0f172a";
    ctxS.font = "9px sans-serif";
    ctxS.fillText(`J${numJogoLabel}`, x + 3, 50);
  }

  if (qtdJogos > 15) {
    ctxT.fillStyle = "#0f172a";
    ctxT.font = "bold 10px sans-serif";
    ctxT.fillText(`... (${qtdJogos} jogos no total da simulação)`, 300, 185);
  }
}

// Texto de Instruções para o Fornecedor
function gerarInstrucoesTexto(produto, veiculo, qtdJogos) {
  const isSider = veiculo.tipo === "Sider";
  const container = document.getElementById('sim-instrucoes');

  let html = `
    <h4>REGRAS OBRIGATÓRIAS DE CARREGAMENTO PARA O FORNECEDOR:</h4>
    <ul>
      <li><strong>NÃO PRENDER VOLUMES DE JOGOS DIFERENTES:</strong> Os volumes devem ser carregados rigorosamente reunidos por <strong>JOGO COMPLETO</strong> (${produto.volumes.length} caixas/jogo).</li>
      <li><strong>Regra de Amarrações:</strong> É expressamente proibido passar fitas ou filmes plástico unindo jogos distintos. As caixas do Jogo 1 NUNCA podem estar presas ao Jogo 2.</li>
  `;

  if (isSider) {
    html += `
      <li><strong>Estratégia para Veículo SIDER:</strong>
        <ul>
          <li>Organizar os produtos em <strong>BLOCO FÍSICO POR JOGO</strong> ao longo do comprimento da carreta.</li>
          <li>Cada jogo (${produto.volumes.length} volumes) deve estar posicionado na lateral do veículo de forma que, ao abrir a lona, a equipe consiga retirar todas as caixas daquele jogo sem mover caixas de outros jogos.</li>
          <li>Posicionar caixas mais pesadas na base e caixas com vidros/espelhos na vertical e protegidas no centro do jogo.</li>
        </ul>
      </li>
    `;
  } else {
    html += `
      <li><strong>Estratégia para Veículo BAÚ:</strong>
        <ul>
          <li>Carregar a caçamba do <strong>FUNDO para a PORTA TRASEIRA</strong>.</li>
          <li>Acomodar o <strong>Jogo 1</strong> mais próximo da porta traseira (último a entrar / primeiro a sair).</li>
          <li>Dispor todos os volumes do mesmo jogo lado a lado ou empilhados entre si, permitindo que a equipe descarregue jogo por jogo sequencialmente pelo fundo.</li>
        </ul>
      </li>
    `;
  }

  html += `
      <li><strong>Composição do Jogo (${produto.volumes.length} volumes):</strong>
        <ul>
          ${produto.volumes.map(v => `<li>Vol ${v.numero}: ${v.descricao} (${v.peso} kg)</li>`).join('')}
        </ul>
      </li>
      <li><strong>Montagem do Palete na Recepção:</strong> Respeitar a norma de <strong>${produto.norma.jogosPorPalete} jogos por palete</strong> (${produto.norma.dimensao}), com lastro de ${produto.norma.lastro} caixas e ${produto.norma.camadas} camadas de altura.</li>
    </ul>
  `;

  container.innerHTML = html;
}

// Exportar PDF
window.exportarPDF = function() {
  const { jsPDF } = window.jspdf;
  const element = document.getElementById('relatorio-impressao');
  
  // Ocultar botões na impressão
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
