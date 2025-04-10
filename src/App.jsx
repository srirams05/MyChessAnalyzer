import React, { useState, useRef, useEffect } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, SQUARES } from 'chess.js';
import './App.css';

// --- Constants ---
const CENTER_SQUARES = ['e4', 'd4', 'e5', 'd5'];

// --- Helper Function ---
function formatScore(score, type) { if(type==='cp'){const e=(score/100).toFixed(2);return(e>0?'+':'')+e;}else if(type==='mate'){return 'M'+score;}return ''; }

// --- React Component ---
function App() {
    // --- State & Refs ---
    const chess = useRef(new Chess());
    const [boardFen, setBoardFen] = useState(chess.current.fen());
    const [fenInput, setFenInput] = useState(boardFen);
    const [fenError, setFenError] = useState('');
    const worker = useRef(null);
    const analyzingFenRef = useRef(null);
    const fenAfterCandidateRef = useRef(null);
    const [engineLoaded, setEngineLoaded] = useState(false);
    const [engineMessage, setEngineMessage] = useState('Loading engine...');
    const isAnalyzingRef = useRef(false);
    const isCheckingCandidateResponseRef = useRef(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analysisPVs, setAnalysisPVs] = useState([]);
    const analysisPVsRef = useRef(analysisPVs);
    const [analysisEval, setAnalysisEval] = useState('');
    const [analysisProgress, setAnalysisProgress] = useState('');
    const [selectedLineIndex, setSelectedLineIndex] = useState(null);
    const [currentMoveInLine, setCurrentMoveInLine] = useState(0);
    const [attackedPieces, setAttackedPieces] = useState([]);
    const [controlledCenterSquares, setControlledCenterSquares] = useState([]);
    const [candidateMoveInput, setCandidateMoveInput] = useState('');
    const [userMoveVisualization, setUserMoveVisualization] = useState(null);
    const [opponentResponses, setOpponentResponses] = useState([]);
    const [isCheckingCandidateResponse, setIsCheckingCandidateResponse] = useState(false);
    const [candidateMoveError, setCandidateMoveError] = useState('');

    // Keep analysisPVsRef updated
    useEffect(() => { analysisPVsRef.current = analysisPVs; }, [analysisPVs]);
    // Debug Log for analysisPVs state changes
    useEffect(() => { console.log("[State Update] analysisPVs changed:", analysisPVs); }, [analysisPVs]);
    // Debug Log for opponentResponses state changes
    useEffect(() => { console.log("[State Update] opponentResponses changed:", opponentResponses); }, [opponentResponses]);


    // --- Load Stockfish Engine via Worker ---
    useEffect(() => {
        console.log('[Effect EngineLoad] Setting up...');
        const workerPath = '/stockfish-nnue-16.js';
        let localWorker;
        try {
            localWorker = new Worker(workerPath);
            console.log("[Effect EngineLoad] Worker created:", localWorker);

            localWorker.onmessage = (event) => {
                if (localWorker !== worker.current) return;
                const message = event.data;
                // console.log('[Stockfish message]:', message);

                if (typeof message !== 'string') return;

                // --- Use REFS for logic conditions, update React State AFTER processing ---
                if (message.startsWith('info') && isAnalyzingRef.current) {
                    // ---> ADDED LOG <---
                    console.log("[OnMessage] Entered block for MAIN analysis info.");
                    let depth=null,nodes=null,scoreType=null,scoreValue=null,pv=null,lineId=null; const parts=message.split(' ');let pvStartIndex=-1; for(let i=0;i<parts.length;i++){ const p=parts[i];const n=parts[i+1];if(p==='depth'&&n)depth=parseInt(n,10);else if(p==='nodes'&&n)nodes=parseInt(n,10);else if(p==='multipv'&&n)lineId=parseInt(n,10);else if(p==='score'&&parts[i+1]&&parts[i+2]){scoreType=parts[i+1];scoreValue=parseInt(parts[i+2],10);i+=2;}else if(p==='pv'){pvStartIndex=i+1;break;}} if(pvStartIndex!==-1)pv=parts.slice(pvStartIndex).join(' ');
                    const newProgressText = `Depth: ${depth || 'N/A'}, Nodes: ${nodes || 'N/A'}`; setAnalysisProgress(currentProgress => currentProgress !== newProgressText ? newProgressText : currentProgress);
                    if (lineId !== null && scoreType !== null && scoreValue !== null && pv !== null) {
                         const formattedScore = formatScore(scoreValue, scoreType); const uciPvString = pv; const currentFenForPV = analyzingFenRef.current;
                         if (!currentFenForPV) { console.error(`[Info Handler] CRITICAL: analyzingFenRef.current is NULL... Info: ${message}`); return; }
                        //  console.log(`[Info Handler] Updating analysisPVs: lineId=${lineId}, ...`);
                         setAnalysisPVs(currentPVs => { const n=[...currentPVs]; const idx=n.findIndex(i=>i.lineId===lineId); const d={lineId,score:formattedScore,uci_pv:uciPvString,start_fen:currentFenForPV}; let c=false; if(idx>-1){if(JSON.stringify(n[idx])!==JSON.stringify(d)){n[idx]=d;c=true;}}else{n.push(d);c=true;} if(c){n.sort((a,b)=>a.lineId-b.lineId);return n.slice(0,3);} return currentPVs; });
                         if (lineId === 1) { setAnalysisEval(currentEval => currentEval !== formattedScore ? formattedScore : currentEval); }
                    }
                }
                 else if (message.startsWith('info') && isCheckingCandidateResponseRef.current) {
                    // ---> ADDED LOG <---
                    console.log("[OnMessage] Entered block for OPPONENT response info.");
                    console.log("[Opponent Response Check] Received info:", message); // Keep this specific log
                     // Parse info line components
                     let pv = null, lineId = null; const parts = message.split(' '); let pvStartIndex = -1;
                     for (let i = 0; i < parts.length; i++) { if(parts[i]==='multipv'&&parts[i+1])lineId=parseInt(parts[i+1],10);else if(parts[i]==='pv'){pvStartIndex=i+1;break;}} if (pvStartIndex !== -1) pv = parts.slice(pvStartIndex).join(' ');
                     // Check if we got the lineId and at least one move in the pv
                     if (lineId !== null && pv && (lineId === 1 || lineId === 2)) {
                         const uciMoves = pv.split(' '); const opponentReplyUCI = uciMoves[0];
                         if (opponentReplyUCI) {
                             const fenForThisCheck = fenAfterCandidateRef.current;
                             if (!fenForThisCheck) { console.error("[Opponent Response Check] fenAfterCandidateRef is NULL."); return; }
                             try {
                                 const gameForReply = new Chess(fenForThisCheck); let moveDetail = null; let moveResult = null;
                                 if (opponentReplyUCI.length >= 4 && opponentReplyUCI.length <= 5) { moveDetail = { from: opponentReplyUCI.substring(0, 2), to: opponentReplyUCI.substring(2, 4), promotion: opponentReplyUCI.length === 5 ? opponentReplyUCI.substring(4, 5) : undefined }; moveResult = gameForReply.move(moveDetail, { verbose: true }); }
                                 if (moveResult) {
                                     const isCapture = moveResult.flags.includes('c'); const isCheck = moveResult.san.includes('+') || moveResult.san.includes('#');
                                     const responseData = { lineId, from: moveResult.from, to: moveResult.to, san: moveResult.san, isCapture, isCheck };
                                     console.log(`[Opponent Response Check] Parsed Response ${lineId}:`, responseData);
                                     setOpponentResponses(currentResponses => { const n=[...currentResponses]; const idx=n.findIndex(r=>r.lineId===lineId); if(idx>-1)n[idx]=responseData;else n.push(responseData); n.sort((a,b)=>a.lineId-b.lineId); return n; });
                                 } else { console.warn(`[Opponent Response Check] Could not validate UCI '${opponentReplyUCI}' on FEN '${fenForThisCheck}'.`); }
                             } catch (e) { console.error(`[Opponent Response Check] Error simulating reply '${opponentReplyUCI}':`, e); }
                         }
                     }
                 }
                else if (message.startsWith('bestmove')) {
                    console.log("Received bestmove:", message); let analysisJustFinished = false;
                    if (isAnalyzingRef.current) { console.log("Main analysis finished:", message); isAnalyzingRef.current = false; analysisJustFinished = true; }
                    else if (isCheckingCandidateResponseRef.current) { console.log("Opponent response check finished:", message); isCheckingCandidateResponseRef.current = false; analysisJustFinished = true; }
                    if (analysisJustFinished) { console.log("[Bestmove Handler] Updating React state..."); setIsAnalyzing(false); setIsCheckingCandidateResponse(false); setEngineMessage('Engine ready.'); setAnalysisProgress(''); }
                } else if (message.startsWith('uciok')) { /*...*/ setEngineLoaded(true);setEngineMessage('Engine ready. Initializing...');sendEngineCommand('setoption name Use NNUE value true');sendEngineCommand('setoption name Threads value 4');sendEngineCommand('setoption name Hash value 128');console.log("[Worker Message] Sending 'isready' after uciok...");sendEngineCommand('isready'); }
                  else if (message.startsWith('readyok')) { /*...*/ setEngineMessage('Engine initialized and ready.');performStaticAnalysis(chess.current.fen()); }
                  // ---> ADDED CATCH-ALL FOR INFO <---
                  else if (message.startsWith('info')) {
                       console.warn(`[OnMessage] Unhandled INFO line (isAnalyzing=${isAnalyzingRef.current}, isCheckingCandidate=${isCheckingCandidateResponseRef.current}): ${message}`);
                  }

            }; // end onmessage
            localWorker.onerror = (error) => { /* ... (existing error handling) ... */ if(localWorker!==worker.current)return;console.error('>>> WORKER ONERROR <<<');const e=error?(error.message||'No msg'):'No err';setEngineMessage(`Worker error: ${e}.`);setEngineLoaded(false);isAnalyzingRef.current=false;isCheckingCandidateResponseRef.current=false;setIsAnalyzing(false);setIsCheckingCandidateResponse(false);if(worker.current===localWorker){worker.current.terminate();worker.current=null;}else{localWorker.terminate();}};
            worker.current = localWorker; sendEngineCommand('uci');
        } catch (error) { /* ... (existing error handling) ... */ console.error('[Effect EngineLoad] Error creating worker:',error);setEngineMessage(`Error creating worker: ${error.message}.`);setEngineLoaded(false);}
        return () => { /* ... (existing cleanup logic) ... */ console.log("[Effect EngineLoad] Cleanup for:",localWorker);if(localWorker){localWorker.postMessage('quit');setTimeout(()=>{if(localWorker)localWorker.terminate();},100);}if(worker.current===localWorker){console.log("[Effect EngineLoad] Nullifying worker ref.");worker.current=null;setEngineLoaded(false);setEngineMessage('Engine unloaded.');isAnalyzingRef.current=false;isCheckingCandidateResponseRef.current=false;}else{console.log("[Effect EngineLoad] Cleanup: worker ref changed.");}};
    }, []); // End Engine Load useEffect


    // --- Effect for Spacebar Stepping ---
    useEffect(() => { /* ... (existing code - uses ref for analysisPVs) ... */ console.log('[Effect Spacebar] Setting up...');const h=(e)=>{const i=e.target.matches('input[type="text"]');if(i)return;const s=e.key===' ';if(s){const idx=selectedLineIndex;const an=isAnalyzing;const pvs=analysisPVsRef.current;const c=(idx!==null&&!an);if(c){e.preventDefault();const l=pvs[idx];const v=(l&&l.uci_pv&&l.start_fen);if(v){const m=l.uci_pv.split(' ').length;setCurrentMoveInLine(p=>{const n=Math.min(p+1,m);console.log(`[Keydown] Update move idx ${p}->${n}`);return n;});}}}};window.addEventListener('keydown',h);console.log('[Effect Spacebar] ADDED.');return()=>{console.log('[Effect Spacebar] Cleaning up...');window.removeEventListener('keydown',h);console.log('[Effect Spacebar] REMOVED.');}; }, [selectedLineIndex, isAnalyzing]);

    // --- Effect to Update Board during PV Stepping ---
    useEffect(() => { /* ... (existing code - converts UCI from state to SAN for stepping) ... */ if(selectedLineIndex===null||isAnalyzing)return;const d=analysisPVs[selectedLineIndex];const sf=d?.start_fen;const up=d?.uci_pv;if(!d||!up||!sf)return;let sa=[];try{const g=new Chess(sf);const ui=up.split(' ');const uc=ui.slice(0,currentMoveInLine);for(const um of uc){if(um.length>=4&&um.length<=5){const md={from:um.substring(0,2),to:um.substring(2,4),promotion:um.length===5?um.substring(4,5):undefined};const mr=g.move(md);if(mr)sa.push(mr.san);else throw new Error(`Invalid ${um}`);}else throw new Error(`Invalid UCI ${um}`);}}catch(e){console.error("Err conv step:",e);return;}/*console.log(`PV Board Update: Apply ${sa.length} SAN: [${sa.join(',')}] from ${sf}`);*/try{const rg=new Chess(sf);let ma=true;for(const sm of sa){if(!rg.move(sm)){console.error(`PV Step Err: Apply SAN '${sm}' fail.`);ma=false;break;}}if(ma){const ff=rg.fen();if(boardFen!==ff)setBoardFen(ff);}}catch(e){console.error("Err apply step:",e);}}, [selectedLineIndex, currentMoveInLine, isAnalyzing, analysisPVs, boardFen]);

    // --- Helper to send commands ---
    const sendEngineCommand=(c)=>{if(worker.current)worker.current.postMessage(c);else console.error("No worker.");};

    // --- Static Analysis ---
    const performStaticAnalysis=(cF)=>{try{const g=new Chess(cF);const t=g.turn();const o=t==='w'?'b':'w';const a=[];const c=[];SQUARES.forEach(s=>{const p=g.get(s);if(p&&p.color===t&&g.isAttacked(s,o))a.push({square:s,type:p.type,defended:g.isAttacked(s,t)});});CENTER_SQUARES.forEach(cs=>{if(g.isAttacked(cs,t))c.push(cs);});setAttackedPieces(a);setControlledCenterSquares(c);}catch(e){console.error("Static fail:", e);}};

    // --- Trigger Main Analysis ---
    const startAnalysis=(fen)=>{if(!engineLoaded||!worker.current)return;analyzingFenRef.current=fen;isAnalyzingRef.current=true;isCheckingCandidateResponseRef.current=false;console.log(`[Analysis Start] Set refs: FEN=${fen}, isAnalyzing=true`);setIsAnalyzing(true);setIsCheckingCandidateResponse(false);console.log(`[State Set] Analysis flags.`);setAnalysisPVs([]);setAnalysisEval('');setAnalysisProgress('Starting...');setEngineMessage('Analyzing...');setSelectedLineIndex(null);setCurrentMoveInLine(0);setCandidateMoveInput('');setUserMoveVisualization(null);setOpponentResponses([]);setCandidateMoveError('');sendEngineCommand(`position fen ${fen}`);sendEngineCommand('setoption name MultiPV value 3');sendEngineCommand('go depth 18');};

    // --- PV Line Selection ---
    const handleLineSelect=(idx)=>{if(isAnalyzing||isCheckingCandidateResponse)return;if(selectedLineIndex===idx){setSelectedLineIndex(null);setCurrentMoveInLine(0);if(analyzingFenRef.current)setBoardFen(analyzingFenRef.current);}else{setSelectedLineIndex(idx);setCurrentMoveInLine(0);if(analyzingFenRef.current)setBoardFen(analyzingFenRef.current);}};

    // --- Board Interaction ---
    const handlePieceDrop=(src,tgt)=>{let m=null;try{const g=new Chess(boardFen);m=g.move({from:src,to:tgt,promotion:'q'});if(m===null)return false;const nF=g.fen();setBoardFen(nF);setFenInput(nF);setFenError('');performStaticAnalysis(nF);startAnalysis(nF);return true;}catch(e){console.error('Move err:',e);return false;}};

    // --- Main FEN Input ---
    const handleInputChange=(e)=>{setFenInput(e.target.value);if(fenError)setFenError('');};const handleKeyDown=(e)=>{if(e.key==='Enter')validateAndSetFen(fenInput.trim());};const validateAndSetFen=(fen)=>{setIsAnalyzing(false);setIsCheckingCandidateResponse(false);setCandidateMoveInput('');setUserMoveVisualization(null);setOpponentResponses([]);setCandidateMoveError('');try{const g=new Chess(fen);const vF=g.fen();setBoardFen(vF);setFenInput(vF);setFenError('');performStaticAnalysis(vF);startAnalysis(vF);}catch(e){setFenError('Invalid FEN.');setAttackedPieces([]);setControlledCenterSquares([]);}};

    // --- Candidate Move Input ---
    const handleCandidateInputChange=(e)=>{setCandidateMoveInput(e.target.value);if(candidateMoveError)setCandidateMoveError('');};const handleCandidateKeyDown=(e)=>{if(e.key==='Enter'&&candidateMoveInput.trim()){e.preventDefault();submitCandidateMove(candidateMoveInput.trim());}};
    const submitCandidateMove=(moveInput)=>{if(isAnalyzing||isCheckingCandidateResponse||!engineLoaded)return;console.log(`[Candidate] Validate: ${moveInput}`);setCandidateMoveError('');setUserMoveVisualization(null);setOpponentResponses([]);try{const g=new Chess(boardFen);const mR=g.move(moveInput);if(mR){console.log(`[Candidate] Valid: ${mR.san}`);setUserMoveVisualization({from:mR.from,to:mR.to,san:mR.san});const fenAC=g.fen();fenAfterCandidateRef.current=fenAC;console.log(`[Candidate] FEN after: ${fenAC}`);isCheckingCandidateResponseRef.current=true;isAnalyzingRef.current=false;setIsCheckingCandidateResponse(true);setIsAnalyzing(false);setEngineMessage(`Checking opp responses to ${mR.san}...`);/*setAnalysisPVs([]); Maybe don't clear main PVs? */ sendEngineCommand(`position fen ${fenAC}`);sendEngineCommand('setoption name MultiPV value 2');sendEngineCommand('go movetime 500');}else{setCandidateMoveError(`Invalid: "${moveInput}"`);}}catch(e){console.error("Cand err:",e);setCandidateMoveError(`Err: ${e.message}`);}};

    // --- Calculate Turn Display ---
    let turnDisplay='?';try{const g=new Chess(boardFen);turnDisplay=g.turn()==='w'?'White':'Black';}catch(e){} turnDisplay += ' to play';

    // --- Calculate Arrows ---
    const customArrows = []; if(userMoveVisualization){customArrows.push([userMoveVisualization.from, userMoveVisualization.to, 'green']);}
    opponentResponses.forEach(r=>{const c=(r.isCapture||r.isCheck)?'red':'brown';customArrows.push([r.from,r.to,c]);});

    // --- JSX ---
    return (
        <div className="app-container">
            <div className="board-area"> <Chessboard position={boardFen} onPieceDrop={handlePieceDrop} boardWidth={500} customArrows={customArrows} /><p className="turn-indicator">{turnDisplay}</p></div>
            <div className="analysis-area">
                 <div className="fen-input-container">{/*...*/} <label htmlFor="fenInput">Enter FEN:</label><input type="text" id="fenInput" value={fenInput} onChange={handleInputChange} onKeyDown={handleKeyDown} placeholder="Paste/Enter FEN" disabled={isAnalyzing||isCheckingCandidateResponse}/>{fenError && <p className="error-message">{fenError}</p>}</div>
                 <div className="engine-status"><p><strong>Status:</strong> {engineMessage}</p></div>
                 <div className="candidate-move-input-container">{/*...*/} <h4>Enter Candidate Move</h4><input type="text" value={candidateMoveInput} onChange={handleCandidateInputChange} onKeyDown={handleCandidateKeyDown} placeholder="e.g., e4, Nf3" disabled={isAnalyzing||isCheckingCandidateResponse||!engineLoaded}/>{candidateMoveError && <p className="error-message">{candidateMoveError}</p>}</div>
                 <div className="static-analysis">{/*...*/} <h4>Static Analysis</h4><div><strong>Attacked Pieces:</strong>{attackedPieces.length>0?(<ul>{attackedPieces.map(p=>(<li key={p.square}>{p.type.toUpperCase()} on {p.square} (<span className={p.defended?'':'undefended'}>{p.defended?'Defended':'UNDEFENDED'}</span>)</li>))}</ul>):(<p>None</p>)}</div><div><strong>Controlled Center:</strong>{controlledCenterSquares.length>0?(<p>{controlledCenterSquares.join(', ')}</p>):(<p>None</p>)}</div></div>
                 <div className="analysis-results"><h3>Analysis Results (Top Lines)</h3>{isAnalyzing&&(<div className="progress-indicator">Analyzing... ({analysisProgress})</div>)}{analysisPVs.length > 0 && !isCheckingCandidateResponse && (<div className="pv-lines"><ul>{analysisPVs.map((line, index) => { let dp='(Err)';if(line.start_fen&&line.uci_pv){try{const tG=new Chess(line.start_fen);const uM=line.uci_pv.split(' ');const sM=[];for(const uciM of uM){if(uciM.length>=4&&uciM.length<=5){const mD={from:uciM.substring(0,2),to:uciM.substring(2,4),promotion:uciM.length===5?uciM.substring(4,5):undefined};const mR=tG.move(mD);if(mR)sM.push(mR.san);else{sM.push(`?(${uciM})`);break;}}else{sM.push('?');break;}}dp=sM.join(' ');}catch(e){dp=`${line.uci_pv}(UCI Err)`;}}else if(line.uci_pv){dp=`${line.uci_pv}(UCI FEN?)`;}return(<li key={line.lineId} onClick={()=>handleLineSelect(index)} className={selectedLineIndex===index?'selected-line':''}>({line.score}) {dp}</li>);})}</ul></div>)}{!isAnalyzing&&analysisPVs.length===0&&engineLoaded&&!isCheckingCandidateResponse&&(<p>Analysis will appear here.</p>)}</div>
            </div> {/* End analysis-area */}
        </div> // End app-container
    );
}
export default App;