// Verified GATE CS reference: standard facts and formulas that small models often get wrong.
// Written and checked by hand; used (a) as grounding in every prompt that teaches or solves, and (b) as
// evidence when the fact-checker reviews a lesson. Each entry: { s: subject, k: keywords, f: fact }.
// Keep entries short, exact and uncontroversial (textbook-standard, GATE conventions).

const GATE_FACTS = [
  // ---------- Operating System ----------
  { s: 'Operating System', k: 'fcfs sjf srtf scheduling waiting turnaround', f: 'Turnaround time = completion − arrival; waiting time = turnaround − burst; response time = first start − arrival.' },
  { s: 'Operating System', k: 'sjf srtf optimal average waiting', f: 'SJF (non-preemptive) gives the minimum average waiting time among non-preemptive policies when all jobs arrive together; SRTF (preemptive SJF) is optimal for average waiting time overall. Both can starve long jobs.' },
  { s: 'Operating System', k: 'round robin quantum', f: 'Round robin: as the time quantum → ∞ it becomes FCFS; a very small quantum gives high context-switch overhead. RR has no starvation.' },
  { s: 'Operating System', k: 'priority scheduling starvation aging', f: 'Priority scheduling can starve low-priority processes; aging (raising priority with waiting time) prevents starvation.' },
  { s: 'Operating System', k: 'belady anomaly fifo lru optimal stack algorithm', f: "Belady's anomaly (more frames → more page faults) can occur only in FIFO among the standard policies; LRU and Optimal are stack algorithms and never show it." },
  { s: 'Operating System', k: 'optimal page replacement opt', f: 'Optimal (OPT) replaces the page whose next use is farthest in the future; it gives the minimum number of page faults but needs future knowledge.' },
  { s: 'Operating System', k: 'page table size paging', f: 'Number of pages = 2^(virtual address bits − offset bits); page table size = number of pages × PTE size; offset bits = log₂(page size).' },
  { s: 'Operating System', k: 'tlb effective access time emat', f: 'With a TLB (sequential lookup) and a single-level page table: EMAT = h(t + m) + (1 − h)(t + 2m), where t = TLB time, m = memory time, h = TLB hit ratio.' },
  { s: 'Operating System', k: 'page fault effective access time', f: 'With page faults: EAT = (1 − p) × memory access time + p × page-fault service time, where p is the page-fault rate.' },
  { s: 'Operating System', k: 'deadlock coffman conditions', f: 'Deadlock needs all four (Coffman) conditions at once: mutual exclusion, hold and wait, no preemption, circular wait. Breaking any one prevents deadlock.' },
  { s: 'Operating System', k: 'banker safe state unsafe deadlock', f: "Banker's algorithm: Need = Max − Allocation. A safe state has no deadlock; an unsafe state may (not must) lead to deadlock." },
  { s: 'Operating System', k: 'resource allocation graph cycle deadlock', f: 'In a resource-allocation graph, a cycle means deadlock if every resource has a single instance; with multiple instances a cycle is necessary but not sufficient.' },
  { s: 'Operating System', k: 'deadlock free resources processes minimum', f: 'If n processes each need at most k units of one resource type, the minimum number of units that guarantees no deadlock is n(k − 1) + 1.' },
  { s: 'Operating System', k: 'critical section mutual exclusion progress bounded waiting', f: 'A correct critical-section solution needs mutual exclusion, progress and bounded waiting.' },
  { s: 'Operating System', k: 'semaphore counting binary wait signal', f: 'A counting semaphore: wait/P decrements (blocking when the value would go below 0 in the busy-wait definition, or when it becomes negative in the blocking definition), signal/V increments. A binary semaphore takes values 0 and 1.' },
  { s: 'Operating System', k: 'thrashing working set', f: 'Thrashing: the system spends most of its time paging because processes do not have enough frames for their working sets; reducing the degree of multiprogramming helps.' },
  { s: 'Operating System', k: 'disk access time seek rotational latency transfer', f: 'Disk access time = seek time + rotational latency + transfer time; average rotational latency = half a rotation = 1 / (2 × RPS).' },
  { s: 'Operating System', k: 'fork processes created', f: 'n successive fork() calls (all processes executing them) create 2ⁿ − 1 new child processes, 2ⁿ processes in total.' },
  { s: 'Operating System', k: 'internal external fragmentation paging segmentation', f: 'Paging has internal fragmentation (no external); segmentation has external fragmentation (no internal).' },

  // ---------- Computer Organization and Architecture ----------
  { s: 'Computer Organization and Architecture', k: 'cache direct mapped set associative tag index offset bits', f: 'Address = tag | set index | block offset. Offset bits = log₂(block size); set bits = log₂(number of sets); sets = cache lines / associativity; tag bits = address bits − set bits − offset bits. Fully associative has no index bits.' },
  { s: 'Computer Organization and Architecture', k: 'amat average memory access time hierarchical', f: 'Hierarchical access: AMAT = hit time + miss rate × miss penalty (= t₁ + m₁(t₂ + m₂ t₃) for more levels). Simultaneous access: T = h₁t₁ + (1 − h₁)h₂t₂ + ….' },
  { s: 'Computer Organization and Architecture', k: 'pipeline speedup stages instructions cycle time', f: 'k-stage pipeline, n instructions, no stalls: time = (k + n − 1) × cycle; cycle = max stage delay + latch delay. Ideal speedup → k as n → ∞.' },
  { s: 'Computer Organization and Architecture', k: 'pipeline cpi stalls hazards', f: 'With stalls: CPI = 1 + stall cycles per instruction; speedup = pipeline depth / (1 + stalls per instruction) for equal stages. Hazards: structural, data (RAW, WAR, WAW), control.' },
  { s: 'Computer Organization and Architecture', k: 'ieee 754 single double precision bias exponent mantissa', f: 'IEEE 754 single precision: 1 sign, 8 exponent (bias 127), 23 fraction bits; double: 1, 11 (bias 1023), 52. Normalized value = (−1)^s × 1.f × 2^(e − bias).' },
  { s: 'Computer Organization and Architecture', k: 'addressing modes immediate direct indirect register indexed', f: 'Immediate: operand in the instruction; direct: address in the instruction; indirect: instruction holds the address of the address; indexed/base: effective address = register + displacement.' },
  { s: 'Computer Organization and Architecture', k: 'dma cycle stealing burst', f: 'DMA cycle stealing transfers one word per stolen bus cycle; burst mode transfers a whole block while holding the bus.' },
  { s: 'Computer Organization and Architecture', k: 'write through write back cache', f: 'Write-through updates memory on every write; write-back updates memory only when a dirty block is evicted (needs a dirty bit).' },
  { s: 'Computer Organization and Architecture', k: 'cpu execution time cpi clock', f: 'CPU time = instruction count × CPI × clock cycle time = IC × CPI / clock rate.' },

  // ---------- Digital Logic ----------
  { s: 'Digital Logic', k: 'twos complement range bits signed', f: "n-bit two's complement range: −2^(n−1) to 2^(n−1) − 1. One's complement and sign-magnitude: −(2^(n−1) − 1) to 2^(n−1) − 1, with two zeros." },
  { s: 'Digital Logic', k: 'boolean functions number variables', f: 'The number of distinct Boolean functions of n variables is 2^(2ⁿ).' },
  { s: 'Digital Logic', k: 'kmap prime implicant essential', f: 'A prime implicant cannot be combined further; an essential prime implicant covers at least one minterm no other prime implicant covers.' },
  { s: 'Digital Logic', k: 'multiplexer mux implement function', f: 'A 2ⁿ:1 multiplexer implements any function of n variables directly (and of n+1 variables using the extra variable or its complement on the data inputs).' },
  { s: 'Digital Logic', k: 'flip flop characteristic equation jk d t sr', f: 'Characteristic equations: D: Q⁺ = D; T: Q⁺ = T ⊕ Q; JK: Q⁺ = JQ′ + K′Q; SR: Q⁺ = S + R′Q (with SR = 0).' },
  { s: 'Digital Logic', k: 'counter mod ripple synchronous flip flops', f: 'A mod-N counter needs ⌈log₂ N⌉ flip-flops. A ripple counter has delay growing with the number of flip-flops; a synchronous counter clocks all flip-flops together.' },
  { s: 'Digital Logic', k: 'nand nor universal gates', f: 'NAND and NOR are each universal: any Boolean function can be built from only NAND gates (or only NOR gates).' },
  { s: 'Digital Logic', k: 'decoder encoder lines', f: 'An n-to-2ⁿ decoder activates exactly one of 2ⁿ outputs; building an m-to-2^m decoder from smaller ones follows a tree of decoders.' },

  // ---------- Programming and Data Structures ----------
  { s: 'Programming and Data Structures', k: 'binary tree nodes height maximum minimum', f: 'A binary tree of height h (root at height 0) has at most 2^(h+1) − 1 nodes; with n nodes the minimum height is ⌈log₂(n + 1)⌉ − 1. Leaves = internal nodes with 2 children + 1.' },
  { s: 'Programming and Data Structures', k: 'number of binary trees bst catalan unlabeled', f: 'Number of structurally different binary trees with n nodes (= number of BSTs on n distinct keys) is the Catalan number C(2n, n)/(n + 1): 1, 1, 2, 5, 14, 42 for n = 0..5.' },
  { s: 'Programming and Data Structures', k: 'heap build insert delete complexity', f: 'Binary heap: build-heap O(n); insert and delete-min/max O(log n); find-min/max O(1). In a min-heap the maximum is among the leaves.' },
  { s: 'Programming and Data Structures', k: 'array row major column major address', f: 'Row-major A[i][j] (0-based, R×C): base + (i × C + j) × size. Column-major: base + (j × R + i) × size.' },
  { s: 'Programming and Data Structures', k: 'hashing load factor chaining open addressing probing', f: 'Load factor α = n / m. Chaining: expected comparisons are proportional to the list length: about 1 + α for an unsuccessful search and 1 + α/2 for a successful one. Linear probing suffers primary clustering; quadratic probing secondary clustering; double hashing avoids both.' },
  { s: 'Programming and Data Structures', k: 'linear probing expected probes successful unsuccessful search open addressing uniform hashing', f: 'Expected probes, open addressing with load factor α < 1: uniform hashing: unsuccessful ≤ 1/(1 − α), successful ≈ (1/α) ln(1/(1 − α)). Linear probing (Knuth): successful ≈ ½(1 + 1/(1 − α)), unsuccessful ≈ ½(1 + 1/(1 − α)²).' },
  { s: 'Programming and Data Structures', k: 'stack queue infix postfix prefix', f: 'Converting infix to postfix uses an operator stack; evaluating postfix uses an operand stack. A queue can be built from two stacks.' },
  { s: 'Programming and Data Structures', k: 'c static variable storage scope', f: 'A static local variable in C is initialised once and keeps its value between calls; it is shared by all recursive calls.' },
  { s: 'Programming and Data Structures', k: 'parameter passing call by value reference', f: 'C passes arguments by value; passing a pointer lets the function modify the caller’s object through it.' },
  { s: 'Programming and Data Structures', k: 'bst inorder traversal sorted', f: 'An inorder traversal of a binary search tree visits keys in sorted (non-decreasing) order. Preorder + inorder (or postorder + inorder) uniquely determine a binary tree.' },
  { s: 'Programming and Data Structures', k: 'avl tree height rotations', f: 'AVL trees keep |height(left) − height(right)| ≤ 1; search, insert and delete are O(log n).' },

  // ---------- Algorithms ----------
  { s: 'Algorithms', k: 'master theorem recurrence', f: 'Master theorem for T(n) = aT(n/b) + Θ(n^k logᵖ n): if log_b a > k → Θ(n^(log_b a)); if log_b a = k and p > −1 → Θ(n^k log^(p+1) n); if log_b a < k and p ≥ 0 → Θ(n^k logᵖ n).' },
  { s: 'Algorithms', k: 'sorting complexity stable in place merge quick heap insertion', f: 'Merge sort Θ(n log n) all cases, stable, not in place. Quick sort average Θ(n log n), worst Θ(n²), not stable, in place. Heap sort Θ(n log n), not stable, in place. Insertion sort worst Θ(n²), best Θ(n), stable.' },
  { s: 'Algorithms', k: 'comparison sort lower bound', f: 'Any comparison-based sort needs Ω(n log n) comparisons in the worst case. Counting/radix sort can beat this because they do not compare.' },
  { s: 'Algorithms', k: 'binary search comparisons', f: 'Binary search on n sorted elements takes at most ⌊log₂ n⌋ + 1 comparisons; time O(log n).' },
  { s: 'Algorithms', k: 'dijkstra negative weights bellman ford', f: 'Dijkstra needs non-negative edge weights; O((V + E) log V) with a binary heap. Bellman-Ford handles negative weights in O(VE) and detects negative cycles.' },
  { s: 'Algorithms', k: 'mst kruskal prim unique', f: "Kruskal O(E log E), Prim O(E log V) with a binary heap. If all edge weights are distinct, the MST is unique. A spanning tree of a connected graph with V vertices has V − 1 edges." },
  { s: 'Algorithms', k: 'bfs dfs complexity shortest path unweighted', f: 'BFS and DFS take O(V + E) with adjacency lists (O(V²) with a matrix). BFS gives shortest paths in unweighted graphs.' },
  { s: 'Algorithms', k: 'dynamic programming lcs matrix chain knapsack', f: 'LCS O(mn); matrix-chain multiplication O(n³); 0/1 knapsack O(nW) (pseudo-polynomial); Floyd-Warshall O(V³).' },
  { s: 'Algorithms', k: 'np complete np hard p', f: 'If any NP-complete problem is in P then P = NP. To show X is NP-hard, reduce a known NP-hard problem to X in polynomial time.' },
  { s: 'Algorithms', k: 'huffman coding greedy', f: 'Huffman coding repeatedly merges the two least-frequent symbols; it gives an optimal prefix-free code.' },

  // ---------- Theory of Computation ----------
  { s: 'Theory of Computation', k: 'regular languages closure properties', f: 'Regular languages are closed under union, intersection, complement, concatenation, Kleene star, reversal, difference and homomorphism.' },
  { s: 'Theory of Computation', k: 'context free languages closure properties', f: 'Context-free languages are closed under union, concatenation and Kleene star, but NOT under intersection or complement. CFL ∩ regular is context-free.' },
  { s: 'Theory of Computation', k: 'dcfl deterministic context free closure', f: 'Deterministic CFLs are closed under complement but not under union or intersection.' },
  { s: 'Theory of Computation', k: 'nfa dfa equivalence subset construction states', f: 'Every NFA has an equivalent DFA (subset construction); an n-state NFA may need up to 2ⁿ DFA states.' },
  { s: 'Theory of Computation', k: 'decidable undecidable halting emptiness', f: 'Undecidable for Turing machines: halting, emptiness, equivalence, and any non-trivial property of the language (Rice’s theorem). For CFGs, membership and emptiness are decidable; equivalence and ambiguity are undecidable.' },
  { s: 'Theory of Computation', k: 'recursive recursively enumerable complement', f: 'Recursive (decidable) languages are closed under complement; if L and its complement are both recursively enumerable then L is recursive.' },
  { s: 'Theory of Computation', k: 'pumping lemma anbn not regular', f: '{aⁿbⁿ} is context-free but not regular; {aⁿbⁿcⁿ} is not context-free.' },
  { s: 'Theory of Computation', k: 'chomsky hierarchy', f: 'Chomsky hierarchy: regular ⊂ context-free ⊂ context-sensitive ⊂ recursively enumerable (each inclusion proper).' },

  // ---------- Compiler Design ----------
  { s: 'Compiler Design', k: 'parser power ll lr slr lalr clr', f: 'Grammar classes: LL(1) ⊂ LR(1); LR(0) ⊂ SLR(1) ⊂ LALR(1) ⊂ CLR(1)=LR(1). LALR has the same number of states as SLR/LR(0) (fewer than CLR).' },
  { s: 'Compiler Design', k: 'll1 left recursion ambiguity left factoring', f: 'An LL(1) grammar cannot be left-recursive or ambiguous; left recursion must be removed and common prefixes left-factored first.' },
  { s: 'Compiler Design', k: 'lalr conflicts reduce reduce shift reduce', f: 'Merging CLR(1) states into LALR(1) can introduce reduce-reduce conflicts but never new shift-reduce conflicts.' },
  { s: 'Compiler Design', k: 'first follow sets', f: 'FIRST(α) = terminals that can begin strings derived from α (with ε if α ⇒* ε). FOLLOW(A) = terminals that can appear right after A; $ ∈ FOLLOW(start symbol).' },
  { s: 'Compiler Design', k: 's attributed l attributed sdt', f: 'S-attributed definitions use only synthesized attributes (evaluated bottom-up); L-attributed allow inherited attributes from the parent and left siblings. Every S-attributed definition is L-attributed.' },
  { s: 'Compiler Design', k: 'phases compiler lexical syntax semantic', f: 'Phases: lexical analysis (tokens), syntax analysis (parse tree), semantic analysis (types), intermediate code, optimization, code generation; the symbol table is used throughout.' },
  { s: 'Compiler Design', k: 'basic block leader three address code', f: 'Leaders: the first instruction, any target of a jump, and any instruction right after a jump. A basic block runs from a leader up to (not including) the next leader.' },

  // ---------- Databases ----------
  { s: 'Databases', k: 'normal forms bcnf 3nf 2nf', f: 'BCNF: every non-trivial FD X → A has X a superkey. 3NF: X is a superkey or A is prime. 2NF: no non-prime attribute depends on a proper subset of a candidate key. BCNF ⊂ 3NF ⊂ 2NF ⊂ 1NF.' },
  { s: 'Databases', k: 'decomposition lossless dependency preserving', f: 'A decomposition of R into R1, R2 is lossless iff R1 ∩ R2 → R1 or R1 ∩ R2 → R2. 3NF decomposition can always be lossless and dependency-preserving; BCNF always lossless but not always dependency-preserving.' },
  { s: 'Databases', k: 'candidate key superkey prime attribute', f: 'A superkey determines all attributes; a candidate key is a minimal superkey; prime attributes belong to some candidate key.' },
  { s: 'Databases', k: 'conflict serializability precedence graph view', f: 'A schedule is conflict-serializable iff its precedence graph is acyclic. Every conflict-serializable schedule is view-serializable, not conversely.' },
  { s: 'Databases', k: 'two phase locking 2pl deadlock cascading', f: 'Basic 2PL guarantees conflict serializability but not freedom from deadlock or cascading aborts; strict 2PL also avoids cascading aborts.' },
  { s: 'Databases', k: 'b tree b+ tree order keys children', f: 'In a B-tree of order p (max p children), each node has at most p − 1 keys and every non-root node at least ⌈p/2⌉ children. In a B+ tree all records/pointers to data are in the leaves, which are linked.' },
  { s: 'Databases', k: 'sql null aggregate count', f: 'In SQL, comparisons with NULL are unknown (not true); COUNT(*) counts rows, COUNT(col) and other aggregates ignore NULLs.' },
  { s: 'Databases', k: 'relational algebra join natural division', f: 'Natural join matches equal values on common attributes. Division R ÷ S gives tuples of R related to every tuple of S.' },

  // ---------- Computer Networks ----------
  { s: 'Computer Networks', k: 'stop and wait efficiency sliding window go back n selective repeat', f: 'a = Tp / Tt. Stop-and-wait efficiency = 1 / (1 + 2a). Window W: efficiency = min(1, W / (1 + 2a)). Go-Back-N window ≤ 2^k − 1; Selective Repeat window ≤ 2^(k−1) for k-bit sequence numbers.' },
  { s: 'Computer Networks', k: 'csma cd minimum frame size collision', f: 'CSMA/CD needs transmission time ≥ 2 × propagation delay, so minimum frame size = 2 × Tp × bandwidth. Ethernet minimum frame is 64 bytes.' },
  { s: 'Computer Networks', k: 'aloha efficiency pure slotted', f: 'Maximum throughput: pure ALOHA 1/(2e) ≈ 18.4%; slotted ALOHA 1/e ≈ 36.8%.' },
  { s: 'Computer Networks', k: 'subnet hosts cidr broadcast network', f: 'A /n IPv4 block has 2^(32−n) addresses and 2^(32−n) − 2 usable hosts; network address = host bits all 0; broadcast = host bits all 1.' },
  { s: 'Computer Networks', k: 'tcp udp header size ports', f: 'TCP header is 20–60 bytes, UDP header 8 bytes; IPv4 header 20–60 bytes. TCP is connection-oriented and reliable; UDP is connectionless.' },
  { s: 'Computer Networks', k: 'tcp congestion control slow start ssthresh', f: 'TCP slow start doubles cwnd every RTT up to ssthresh, then congestion avoidance adds 1 MSS per RTT; on timeout ssthresh = cwnd/2 and cwnd restarts at 1 MSS.' },
  { s: 'Computer Networks', k: 'crc error detection hamming distance', f: 'To detect d errors a code needs minimum Hamming distance d + 1; to correct d errors, 2d + 1. CRC with an r-bit-degree generator detects all burst errors of length ≤ r.' },
  { s: 'Computer Networks', k: 'osi layers protocols', f: 'Routers work at the network layer, switches/bridges at the data link layer, hubs/repeaters at the physical layer. ARP maps IP to MAC; DNS uses UDP port 53; HTTP uses TCP port 80.' },
  { s: 'Computer Networks', k: 'distance vector link state count to infinity', f: 'Distance-vector routing (Bellman-Ford, e.g. RIP) suffers count-to-infinity; link-state (Dijkstra, e.g. OSPF) floods link states to all routers.' },

  // ---------- Discrete Mathematics ----------
  { s: 'Discrete Mathematics', k: 'handshaking degree edges graph', f: 'Sum of degrees = 2 × number of edges, so the number of odd-degree vertices is even. A tree with n vertices has n − 1 edges.' },
  { s: 'Discrete Mathematics', k: 'planar graph euler formula', f: 'Connected planar graph: V − E + F = 2; a simple planar graph with V ≥ 3 has E ≤ 3V − 6 (E ≤ 2V − 4 if triangle-free). K₅ and K₃,₃ are not planar.' },
  { s: 'Discrete Mathematics', k: 'euler circuit path hamiltonian', f: 'A connected graph has an Euler circuit iff every vertex has even degree, and an Euler path iff exactly 0 or 2 vertices have odd degree.' },
  { s: 'Discrete Mathematics', k: 'relations reflexive symmetric number', f: 'On a set of n elements: 2^(n²) relations, 2^(n²−n) reflexive relations, 2^(n(n+1)/2) symmetric relations.' },
  { s: 'Discrete Mathematics', k: 'permutation combination counting', f: 'nPr = n!/(n − r)!; nCr = n!/(r!(n − r)!); arrangements of n items with repeats n!/(n₁! n₂! …).' },
  { s: 'Discrete Mathematics', k: 'pigeonhole', f: 'Pigeonhole: placing n items into m boxes puts at least ⌈n/m⌉ items in some box.' },
  { s: 'Discrete Mathematics', k: 'group cyclic lagrange order', f: 'Lagrange: the order of a subgroup divides the order of a finite group. Every group of prime order is cyclic.' },
  { s: 'Discrete Mathematics', k: 'propositional logic tautology implication contrapositive', f: 'p → q ≡ ¬p ∨ q ≡ ¬q → ¬p (contrapositive). The converse q → p and inverse ¬p → ¬q are not equivalent to p → q.' },

  // ---------- Linear Algebra, Calculus, Probability ----------
  { s: 'Linear Algebra', k: 'eigenvalues trace determinant', f: 'The sum of the eigenvalues equals the trace; their product equals the determinant. A matrix is singular iff 0 is an eigenvalue.' },
  { s: 'Linear Algebra', k: 'rank system linear equations solutions', f: 'Ax = b is consistent iff rank(A) = rank([A|b]); with n unknowns the solution is unique iff that rank = n, otherwise infinitely many.' },
  { s: 'Linear Algebra', k: 'eigenvalues triangular symmetric inverse power', f: 'Triangular matrices have their diagonal entries as eigenvalues; real symmetric matrices have real eigenvalues. If λ is an eigenvalue of A, then λᵏ is one of Aᵏ and 1/λ of A⁻¹.' },
  { s: 'Calculus', k: 'maxima minima derivative', f: "Critical points where f′(x) = 0: f″(x) > 0 gives a local minimum, f″(x) < 0 a local maximum." },
  { s: 'Calculus', k: 'mean value theorem rolle', f: "Mean value theorem: f continuous on [a, b], differentiable on (a, b) ⇒ some c in (a, b) has f′(c) = (f(b) − f(a))/(b − a)." },
  { s: 'Probability and Statistics', k: 'bayes theorem conditional', f: 'Bayes: P(A|B) = P(B|A)P(A) / P(B), with P(B) = Σ P(B|Aᵢ)P(Aᵢ) over a partition.' },
  { s: 'Probability and Statistics', k: 'binomial poisson mean variance', f: 'Binomial(n, p): mean np, variance np(1 − p). Poisson(λ): mean = variance = λ. Geometric (trials to first success): mean 1/p.' },
  { s: 'Probability and Statistics', k: 'expectation variance linearity independent', f: 'E[X + Y] = E[X] + E[Y] always; Var(X + Y) = Var(X) + Var(Y) when X and Y are independent; Var(aX + b) = a² Var(X).' },
  { s: 'Probability and Statistics', k: 'uniform exponential normal distribution', f: 'Uniform(a, b): mean (a + b)/2, variance (b − a)²/12. Exponential(λ): mean 1/λ, memoryless. Normal: about 68% / 95% / 99.7% within 1 / 2 / 3 standard deviations.' },
];

// The reference entries most relevant to some text (lesson title, question, chat message…).
// Your own facts (saved from fact-check panels or Settings) join the reference as M1, M2, …
let MY_FACTS = [];
async function loadMyFacts() { try { MY_FACTS = ((await Store.getHub()).myFacts || []).filter(f => f && f.f); } catch {} return MY_FACTS; }
async function saveMyFact({ f, s = '', from = '' }) {
  f = String(f || '').trim();
  if (f.length < 10) throw new Error('Write the fact as a full sentence.');
  await updateHub(h => { h.myFacts = (h.myFacts || []).concat([{ id: uid(), s, k: [...new Set(topicTokens(f))].slice(0, 14).join(' '), f, from: String(from).slice(0, 120), added: new Date().toISOString() }]); });
  await loadMyFacts(); announce({ type: 'facts' });
}
loadMyFacts();
onBus(m => { if (m.type === 'facts') loadMyFacts(); });
function factsFor(text, max = 8, subject = '') {
  const q = new Set(topicTokens(text));
  if (!q.size) return [];
  const pool = GATE_FACTS.map((e, i) => ({ e, id: 'R' + (i + 1) })).concat(MY_FACTS.map((e, i) => ({ e, id: 'M' + (i + 1) })));
  const scored = pool.map(({ e, id }) => {
    const keys = topicTokens(e.k || ''), words = topicTokens(e.f);
    const hit = keys.filter(w => q.has(w)).length * 3 + words.filter(w => q.has(w)).length * 0.5 + (subject && e.s === subject ? 1 : 0);
    return { e, id, hit };
  }).filter(x => x.hit >= 3).sort((a, b) => b.hit - a.hit).slice(0, max);
  return scored.map(x => ({ id: x.id, s: x.e.s, k: x.e.k, f: x.e.f }));
}
function factsBlock(facts) {
  if (!facts.length) return '';
  return `\n\nVERIFIED REFERENCE FACTS (checked, textbook-standard GATE conventions; trust these over your memory, and if anything you write would contradict them, follow these):\n${facts.map(f => `[${f.id}] ${f.f}`).join('\n')}`;
}
