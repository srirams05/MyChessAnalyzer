import React, { useState, useRef, useEffect } from 'react'; // Added useEffect
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
// REMOVED: import stockfish from 'stockfish';
import './App.css';


// --- Helper Function (outside the component) ---
function formatScore(score, type) {
  if (type === 'cp') {
      const evalNum = (score / 100.0).toFixed(2);
      // Add '+' sign for positive scores
      return (evalNum > 0 ? '+' : '') + evalNum;
  } else if (type === 'mate') {
      // Prepend 'M' for mate scores
      return 'M' + score;
  }
  return ''; // Return empty if type is unknown
}


function App() {
    // --- Chess State ---
    const chess = useRef(new Chess()); // Persistent chess logic instance for validation etc.
    const [boardFen, setBoardFen] = useState(chess.current.fen()); // FEN displayed on the board
    const [fenInput, setFenInput] = useState(boardFen); // FEN in the input field
    const analyzingFenRef = useRef(null); // <-- Add this ref
    const [fenError, setFenError] = useState(''); // FEN validation error message

    // --- Stockfish State (Using Manual Worker) ---
    const worker = useRef(null); // Holds the Worker instance
    const [engineLoaded, setEngineLoaded] = useState(false); // Track loading status
    const [engineMessage, setEngineMessage] = useState('Loading engine...'); // User feedback

    // --- Analysis State --- New State Variables ---
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    // Store PVs as an array of objects: { lineId: 1, score: '+0.5', pv: 'e4 c5' }
    const [analysisPVs, setAnalysisPVs] = useState([]);
    // Store overall best score separately for easy display
    const [analysisEval, setAnalysisEval] = useState('');
    // Store some progress info
    const [analysisProgress, setAnalysisProgress] = useState('');
    // --- End of New State Variables ---


    // --- Load Stockfish Engine via Worker ---
    // --- Load Stockfish Engine via Worker ---
    useEffect(() => {
      console.log('Effect Setup: Attempting to load Stockfish worker...');
      const workerPath = '/stockfish-nnue-16.js'; // Adjust if needed

      // Create the worker instance locally within this effect run
      let localWorker;
      try {
          localWorker = new Worker(workerPath);
      } catch (error) {
           console.error('Effect Setup: Error creating worker:', error);
           setEngineMessage(`Error creating worker: ${error.message}. Check file path & console.`);
           setEngineLoaded(false);
           return; // Exit effect if worker creation fails
      }

      console.log("Effect Setup: Worker created successfully.", localWorker);

      // --- Worker Message Handling ---
      localWorker.onmessage = (event) => {
        if (localWorker !== worker.current) return; // Ignore stale worker messages

        const message = event.data;
        console.log('Stockfish message:', message);

        if (typeof message !== 'string') return;

        if (message.startsWith('uciok')) {
            // ... (keep existing uciok logic: set loaded, init options, send isready) ...
             setEngineLoaded(true);
             setEngineMessage('Engine ready. Initializing...');
             sendEngineCommand('setoption name Use NNUE value true');
             sendEngineCommand('setoption name Threads value 4');
             sendEngineCommand('setoption name Hash value 128');
             console.log("Sending 'isready' command after uciok...");
             sendEngineCommand('isready');
        } else if (message.startsWith('readyok')) {
             setEngineMessage('Engine initialized and ready.');
             // Maybe trigger analysis for initial position?
             // startAnalysis(boardFen); // Optional: Uncomment to analyze on load
        } else if (message.startsWith('info')) {
            // --- Parse INFO lines ---
            setIsAnalyzing(true); // Ensure analysis state is true
            setEngineMessage('Analyzing...'); // Update status

                // --- Robust Parsing of INFO line ---
                let depth = null, nodes = null, scoreType = null, scoreValue = null, pv = null, lineId = null;

                const parts = message.split(' ');
                let pvStartIndex = -1;

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    const nextPart = parts[i+1];

                    if (part === 'depth' && nextPart) depth = parseInt(nextPart, 10);
                    else if (part === 'nodes' && nextPart) nodes = parseInt(nextPart, 10);
                    else if (part === 'multipv' && nextPart) lineId = parseInt(nextPart, 10);
                    else if (part === 'score' && parts[i+1] && parts[i+2]) {
                         scoreType = parts[i+1]; // 'cp' or 'mate'
                         scoreValue = parseInt(parts[i+2], 10);
                         i += 2; // Skip the next two parts
                    }
                    // Find the 'pv' keyword; the actual moves start after it
                    else if (part === 'pv') {
                        pvStartIndex = i + 1;
                        break; // Stop searching for keywords after 'pv'
                    }
                }

                // If we found the start of the pv moves
                if (pvStartIndex !== -1) {
                    pv = parts.slice(pvStartIndex).join(' '); // Join all remaining parts as the pv string
                }

                // --- Update Progress ---
                const progressText = `Depth: ${depth || 'N/A'}, Nodes: ${nodes || 'N/A'}`;
                setAnalysisProgress(progressText);

                // --- Check if we have enough data to process a PV line ---
                if (lineId !== null && scoreType !== null && scoreValue !== null && pv !== null) {
                     const formattedScore = formatScore(scoreValue, scoreType);
                     const uciPvString = pv; // Use the directly extracted pv string

                // --- UCI to SAN Conversion ---
                let sanMovesString = 'Error converting PV';
                const startFen = analyzingFenRef.current;
                // const startFen = boardFen; // <-- Get FEN directly from state

                if (startFen) {
                    try {
                        // ---> INITIALIZE THE GAME INSTANCE *ONCE* HERE <---
                        const tempGame = new Chess(startFen);
                        // ---> END OF CHANGE <---
                                                    // ---> ADD THESE LOGS <---
                                                    console.log(`[Converter] Initialized tempGame with FEN: ${startFen}`);
                                                    console.log(`[Converter] tempGame.turn(): ${tempGame.turn()}`);
                                                    console.log(`[Converter] tempGame.moves():`, tempGame.moves()); // Log legal moves
                                                    // ---> END OF ADDED LOGS <---
                        const uciMoves = uciPvString.split(' ');
                        const sanMoves = [];

                        // ---> LOOP THROUGH MOVES ON THE *SAME* INSTANCE <---
                        for (const uciMove of uciMoves) {
                          console.log(`[Converter] Attempting UCI move: ${uciMove}`);

                          // ---> Explicitly create move object <---
                          if (uciMove.length >= 4 && uciMove.length <= 5) { // Basic check for uci format like 'e2e4' or 'e7e8q'
                              const moveDetail = {
                                  from: uciMove.substring(0, 2),
                                  to: uciMove.substring(2, 4),
                                  promotion: uciMove.length === 5 ? uciMove.substring(4, 5) : undefined
                              };
                              // ---> END OF CHANGE <---

                              // ---> Make move using the object, NO sloppy: true needed <---
                              const moveResult = tempGame.move(moveDetail);

                              if (moveResult) {
                                  sanMoves.push(moveResult.san);
                              } else {
                                  console.warn(`Engine PV move failed conversion. FEN: ${startFen}, UCI Move: ${uciMove} (parsed as ${JSON.stringify(moveDetail)}), PV so far: ${sanMoves.join(' ')}`);
                                  console.warn(`[Converter] Board state at failure: ${tempGame.fen()}`);
                                  sanMoves.push(`?(${uciMove})`);
                                  break;
                              }
                          } else {
                               // Handle case where uciMove string isn't valid format
                               console.warn(`Invalid UCI move format in PV: '${uciMove}'. FEN: ${startFen}`);
                               sanMoves.push('?');
                               break;
                          }
                      }
                        sanMovesString = sanMoves.join(' ');
                    } catch (convError) {
                         console.error("Error during UCI to SAN conversion:", convError, "FEN:", startFen, "PV:", uciPvString);
                    }
                } else {
                     console.warn("Cannot convert PV to SAN: starting FEN is not available.");
                     sanMovesString = uciPvString + ' (UCI - FEN missing)';
                }
                // --- End of Conversion ---
                

                // Update the analysisPVs state
                // Update the analysisPVs state with SAN string
                setAnalysisPVs(currentPVs => {
                  const newPVs = [...currentPVs];
                  const existingIndex = newPVs.findIndex(item => item.lineId === lineId);

                  // Store the SAN version in the state
                  const pvData = { lineId, score: formattedScore, pv: sanMovesString };

                  if (existingIndex > -1) {
                      newPVs[existingIndex] = pvData;
                  } else {
                      newPVs.push(pvData);
                  }
                  newPVs.sort((a, b) => a.lineId - b.lineId);
                  return newPVs.slice(0, 3);
              });

                // Update the main evaluation display based on the primary line (lineId 1)
                if (lineId === 1) {
                    setAnalysisEval(formattedScore);
                }
            }
            // --- End of INFO parsing ---
        } else if (message.startsWith('bestmove')) {
            // --- Handle BESTMOVE (analysis finished) ---
            setIsAnalyzing(false);
            setEngineMessage('Analysis complete.');
            setAnalysisProgress(''); // Clear progress text
            // Note: bestmove might include ponder suggestion, e.g., "bestmove e2e4 ponder e7e5"
            // We are currently ignoring the ponder part.
            console.log("Analysis finished:", message);
            // --- End of BESTMOVE handling ---
        }
    };

      // --- Worker Error Handling ---
      localWorker.onerror = (error) => {
           // Ensure we only process errors if this is the current worker
           if (localWorker !== worker.current) {
               console.log(">>> Error received from stale/previous worker instance, ignoring.", error);
               return;
           }

          console.error('>>> WORKER ONERROR HANDLER TRIGGERED <<<');
          console.error('Worker error event object:', error);
          const errorMessage = error ? (error.message || 'No error message property') : 'Error event object is null/undefined';
          console.error('Worker error message extracted:', errorMessage);

          setEngineMessage(`Worker error: ${errorMessage}. Check console.`);
          setEngineLoaded(false);

           // Terminate and clean up the ref
           if (worker.current === localWorker) { // Double check ref before nulling
              console.log("Terminating current worker due to onerror event...");
              worker.current.terminate();
              worker.current = null; // Null the ref ONLY if it's the one that errored
           } else {
              console.log("Error from worker, but worker.current points elsewhere or is null. Terminating local instance.");
              localWorker.terminate(); // Still terminate the local one that errored
           }
      };

      // --- Assign to Ref and Send Initial Command ---
      // Assign the ref *after* handlers are set up for the localWorker
      worker.current = localWorker;
      // Now send 'uci' using the helper which checks worker.current
      sendEngineCommand('uci');


      // --- Cleanup Function ---
      return () => {
          // This cleanup function closes over the 'localWorker' instance created above.
          console.log("Effect Cleanup: Running for worker instance:", localWorker);

          if (localWorker) {
              localWorker.postMessage('quit'); // Try polite quit first
              // Use a short timeout before force terminating to allow 'quit' potentially
              setTimeout(() => {
                  console.log("Effect Cleanup: Force terminating worker instance:", localWorker);
                  if(localWorker) localWorker.terminate(); // Check again inside timeout
              }, 100); // Increased timeout slightly
          }

          // Only nullify the ref if it *still* points to the worker instance
          // that this cleanup function is responsible for. Avoids nullifying the
          // ref if the effect has already run again and assigned a *new* worker.
          if (worker.current === localWorker) {
              console.log("Effect Cleanup: Nullifying worker.current ref as it matches the closing worker.");
              worker.current = null;
              setEngineLoaded(false); // Reset loaded state on cleanup
              setEngineMessage('Engine unloaded.');
          } else {
               console.log("Effect Cleanup: worker.current ref points to a different/null worker. Not nullifying ref.");
          }
      };
  }, []); // Empty dependency array ensures this setup runs only on initial mount/unmount cycles


    // --- Helper to send commands to Stockfish Worker ---
    const sendEngineCommand = (command) => {
        if (worker.current) {
            console.log("Sending command:", command);
            worker.current.postMessage(command);
        } else {
            console.error("Cannot send command: Worker not initialized.");
        }
    };


    // --- Function to Trigger Analysis ---
    const startAnalysis = (fen) => {
      if (!engineLoaded || !worker.current) {
          console.log("Engine not ready for analysis.");
          setEngineMessage('Engine not ready.'); // Update status
          return;
      }

          // ---> STORE FEN IN REF *BEFORE* SENDING COMMANDS <---
    analyzingFenRef.current = fen;
    console.log(`Set analyzingFenRef.current = ${fen}`); // Add log

    
      console.log("Requesting analysis for FEN:", fen);

      // Reset previous results and set status
      setIsAnalyzing(true);
      setAnalysisPVs([]); // Clear previous lines
      setAnalysisEval(''); // Clear previous eval
      setAnalysisProgress('Starting...');
      setEngineMessage('Analyzing...'); // Update general status

      // Send commands to Stockfish
      sendEngineCommand(`position fen ${fen}`);
      // Request top 3 lines (MultiPV)
      sendEngineCommand('setoption name MultiPV value 3');
      // Start analysis - e.g., go depth 18 (adjust as desired)
      sendEngineCommand('go depth 18');
  };
  // --- End of Trigger Analysis Function ---

    // --- Piece Drop Logic (Handles moves made ON the board) ---
    const handlePieceDrop = (sourceSquare, targetSquare) => {
        const game = chess.current; // Use the temporary validation instance
        let move = null;
        try {
            // Make move on the temporary instance first for validation
            const tempGame = new Chess(game.fen()); // Clone current state
            move = tempGame.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });

            if(move === null) { // If move is invalid on temp instance
                 console.log(`Invalid move: ${sourceSquare} to ${targetSquare}`);
                 return false;
            }

            // If valid, update the main ref and state
            chess.current = tempGame; // Update main logic ref
            const newFen = chess.current.fen();
            setBoardFen(newFen);
            setFenInput(newFen); // Keep input field in sync
            setFenError('');
            // TODO: Trigger analysis after player move?
            // Example: analyzePosition(newFen);
                    // Start analysis after the move is made
            startAnalysis(newFen); // <--- ADD THIS CALL
            return true;

        } catch (error) {
            console.error('Error making move:', error);
            return false;
        }
    };

    // --- FEN Input Logic ---
    const handleInputChange = (event) => {
        setFenInput(event.target.value);
        if (fenError) setFenError('');
    };

    const handleKeyDown = (event) => {
        if (event.key === 'Enter') {
            validateAndSetFen(fenInput);
        }
    };

    // Function to validate the FEN and update the board/logic instance
    const validateAndSetFen = (fenToValidate) => {
        try {
            const tempGame = new Chess(fenToValidate); // Validate FEN
            const validFen = tempGame.fen(); // Get canonical FEN

            // Update the main chess logic instance
            chess.current = tempGame;

            // Update the board display
            setBoardFen(validFen);
            // Update the input field
            setFenInput(validFen);
            // Clear error
            setFenError('');
            console.log("FEN updated successfully:", validFen);
            // TODO: Trigger analysis after FEN update?
            // Example: analyzePosition(validFen);
            startAnalysis(validFen); // <--- ADD THIS CALL

        } catch (e) {
            setFenError('Invalid FEN string. Please check the format.');
            console.error("Invalid FEN:", fenToValidate, e);
        }
    };

    // --- TODO: Function to trigger analysis ---
    /*
    const analyzePosition = (fen) => {
        if (!engineLoaded || !worker.current) {
            console.log("Engine not ready for analysis.");
            return;
        }
        console.log("Starting analysis for FEN:", fen);
        setEngineMessage('Analyzing...');
        sendEngineCommand(`position fen ${fen}`);
        // Example: Go 5 seconds
        // sendEngineCommand('go movetime 5000');
        // Example: Go depth 15
        sendEngineCommand('go depth 15');
    };
    */


    // --- JSX Return ---
    return (
        <div className="app-container">
            <div className="board-area">
                <Chessboard
                    position={boardFen}
                    onPieceDrop={handlePieceDrop}
                    boardWidth={500} // Or your preferred width
                />
            </div>

            <div className="analysis-area">
                <div className="fen-input-container">
                    <label htmlFor="fenInput">Enter FEN:</label>
                    <input
                        type="text" id="fenInput" name="fenInput" value={fenInput}
                        onChange={handleInputChange} onKeyDown={handleKeyDown}
                        placeholder="Paste FEN string and press Enter"
                        disabled={!engineLoaded} // Disable input until engine is ready
                    />
                    {fenError && <p className="error-message">{fenError}</p>}
                </div>

                {/* Display Engine Status */}
                <div className="engine-status">
                    <p><strong>Engine Status:</strong> {engineMessage}</p>
                </div>

                 {/* Placeholder button to trigger analysis manually for now */}
                 {/* <button onClick={() => analyzePosition(boardFen)} disabled={!engineLoaded}>
                    Analyze Current Position
                 </button> */}


                <div className="analysis-results">
        <h3>Analysis Results</h3>
        {isAnalyzing && (
            <div className="progress-indicator">
                Analyzing... ({analysisProgress})
            </div>
        )}



        {/* Display Principal Variations */}
        {analysisPVs.length > 0 && (
            <div className="pv-lines">
            <strong>Top Lines:</strong>
            <ul>
                {analysisPVs.map((line) => (
                    <li key={line.lineId}>
                        {/* Format: (score) SAN_moves */}
                        ({line.score}) {line.pv}
                    </li>
                ))}
            </ul>
            </div>
        )}

         {/* Show message if no analysis yet and engine is ready */}
         {!isAnalyzing && analysisPVs.length === 0 && engineLoaded && (
             <p>Analysis will appear here after setting a position or making a move.</p>
         )}
    </div>
            </div>
        </div>
    );
}

export default App;