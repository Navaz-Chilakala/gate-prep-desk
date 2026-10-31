// Verified GATE CS reference facts, third batch (gaps in the first two). Same format as facts.js.
GATE_FACTS.push(
  // ---------- Operating System ----------
  { s: 'Operating System', k: 'semaphore value negative waiting processes', f: 'With a counting semaphore implemented with a waiting queue, a negative value −n means n processes are blocked on it.' },
  { s: 'Operating System', k: 'binary semaphore mutex difference ownership', f: 'A mutex has an owner (only the locking thread may unlock it); a binary semaphore has no owner and can be signalled by any process.' },
  { s: 'Operating System', k: 'spooling buffering', f: 'Spooling keeps a queue of jobs for a slow device (such as a printer) on disk so that processes need not wait for the device.' },
  { s: 'Operating System', k: 'long term short term medium term scheduler', f: 'The long-term scheduler controls the degree of multiprogramming, the short-term (CPU) scheduler picks the next ready process, and the medium-term scheduler swaps processes out and in.' },
  { s: 'Operating System', k: 'preemptive non preemptive scheduling', f: 'Non-preemptive scheduling switches only when the running process blocks or ends; preemptive scheduling can also take the CPU away (on a timer interrupt or a higher-priority arrival).' },
  { s: 'Operating System', k: 'cpu utilization throughput response time', f: 'Response time is the time from arrival to the first time a process gets the CPU; turnaround time = completion − arrival; waiting time = turnaround − burst.' },
  { s: 'Operating System', k: 'demand paging lazy swapper', f: 'Demand paging loads a page only when it is first referenced, so a page fault occurs on the first access to each page that is not yet in memory.' },
  { s: 'Operating System', k: 'global local page replacement', f: 'Global page replacement lets a process take frames from others; local replacement chooses only among the process\'s own frames.' },
  { s: 'Operating System', k: 'hard link soft link symbolic', f: 'A hard link is another directory entry for the same inode (it cannot cross file systems); a symbolic link is a separate file holding a path, and it breaks if the target is deleted.' },
  { s: 'Operating System', k: 'free space management bitmap', f: 'A free-space bit vector needs one bit per disk block (e.g. a 1 TB disk with 4 KB blocks needs 2²⁸ bits = 32 MB).' },

  // ---------- Computer Organization and Architecture ----------
  { s: 'Computer Organization and Architecture', k: 'cache size total bits tag memory overhead', f: 'Total cache bits = number of lines × (block bits + tag bits + valid/dirty bits); the tag memory size is lines × tag bits.' },
  { s: 'Computer Organization and Architecture', k: 'fully associative cache tag bits', f: 'In a fully associative cache the address is just tag + block offset; tag bits = address bits − log₂(block size).' },
  { s: 'Computer Organization and Architecture', k: 'pipeline non pipelined time n instructions', f: 'A k-stage pipeline takes (k + n − 1) cycles for n instructions (no stalls); non-pipelined execution takes n × k cycles of the same stage time, so speedup → k as n → ∞.' },
  { s: 'Computer Organization and Architecture', k: 'pipeline stage delay latch clock period', f: 'Pipeline clock period = (slowest stage delay) + latch/register delay.' },
  { s: 'Computer Organization and Architecture', k: 'branch penalty stall cycles cpi', f: 'Effective CPI with branches = 1 + (branch frequency × branch penalty) for an ideal one-cycle-per-instruction pipeline, adding other stall cycles similarly.' },
  { s: 'Computer Organization and Architecture', k: 'war waw raw hazards dependencies', f: 'RAW (read after write) is a true dependency; WAR (anti-dependency) and WAW (output dependency) are name dependencies that register renaming removes.' },
  { s: 'Computer Organization and Architecture', k: 'virtual memory physical address bits', f: 'Virtual address bits = log₂(virtual address space); physical address bits = log₂(physical memory); both split into page/frame number + offset, with offset bits = log₂(page size).' },
  { s: 'Computer Organization and Architecture', k: 'sign extension arithmetic shift', f: 'Sign extension copies the sign bit into new high-order bits; an arithmetic right shift keeps the sign bit (dividing by 2, rounding towards −∞).' },
  { s: 'Computer Organization and Architecture', k: 'cache line replacement lru set', f: 'In a k-way set-associative cache, a block maps to set (block number mod number of sets) and may go in any of the k lines of that set.' },

  // ---------- Digital Logic ----------
  { s: 'Digital Logic', k: 'number system conversion octal hexadecimal binary', f: 'Each octal digit is 3 bits and each hexadecimal digit is 4 bits, so conversion with binary is done group by group from the radix point.' },
  { s: 'Digital Logic', k: 'ones complement range negative zero', f: 'n-bit one\'s complement and sign-magnitude both represent −(2ⁿ⁻¹ − 1) to +(2ⁿ⁻¹ − 1) and have two zeros; two\'s complement represents −2ⁿ⁻¹ to 2ⁿ⁻¹ − 1 with one zero.' },
  { s: 'Digital Logic', k: 'mux 2n to 1 select lines', f: 'A 2ⁿ-to-1 multiplexer has n select lines; any Boolean function of n + 1 variables can be built with a 2ⁿ-to-1 MUX (using one variable and its complement as data inputs).' },
  { s: 'Digital Logic', k: 'flip flop count states counter modulo', f: 'A mod-N counter needs at least ⌈log₂ N⌉ flip-flops.' },
  { s: 'Digital Logic', k: 'setup hold time maximum clock frequency', f: 'Maximum clock frequency = 1 / (t_clk-to-Q + t_combinational(max) + t_setup).' },
  { s: 'Digital Logic', k: 'sequential combinational circuit memory', f: 'Combinational circuit outputs depend only on current inputs; sequential circuit outputs also depend on stored state (flip-flops/latches).' },

  // ---------- Programming and Data Structures ----------
  { s: 'Programming and Data Structures', k: 'binary tree leaves nodes degree two', f: 'In any binary tree, the number of leaves = (number of nodes with two children) + 1.' },
  { s: 'Programming and Data Structures', k: 'complete binary tree height nodes', f: 'A complete binary tree with n nodes has height ⌊log₂ n⌋ (height of a single node = 0).' },
  { s: 'Programming and Data Structures', k: 'binary tree construction inorder preorder postorder unique', f: 'Inorder together with preorder (or postorder, or level order) determines a binary tree uniquely; preorder with postorder alone does not (unless the tree is full).' },
  { s: 'Programming and Data Structures', k: 'heap kth smallest max heap minimum leaf', f: 'In a max-heap the minimum element is at one of the leaves (indices ⌊n/2⌋ + 1 … n, 1-based).' },
  { s: 'Programming and Data Structures', k: 'queue using two stacks amortized', f: 'A queue implemented with two stacks has O(1) amortised enqueue and dequeue (O(n) worst case for a single dequeue).' },
  { s: 'Programming and Data Structures', k: 'c array of pointers pointer to array declaration', f: 'In C, int *a[10] is an array of 10 pointers to int; int (*a)[10] is a pointer to an array of 10 ints.' },
  { s: 'Programming and Data Structures', k: 'c string literal sizeof strlen', f: 'In C, sizeof("abc") is 4 (it counts the terminating \\0) while strlen("abc") is 3.' },
  { s: 'Programming and Data Structures', k: 'c integer division modulo negative', f: 'In C (C99 onwards), integer division truncates towards zero, so −7 / 2 = −3 and −7 % 2 = −1.' },
  { s: 'Programming and Data Structures', k: 'c switch fall through break', f: 'In a C switch, execution falls through to the following cases until a break (or the end of the switch).' },
  { s: 'Programming and Data Structures', k: 'recursion stack depth space', f: 'A recursive function uses stack space proportional to its maximum recursion depth (e.g. O(n) for a linear recursion, O(log n) for balanced halving).' },

  // ---------- Algorithms ----------
  { s: 'Algorithms', k: 'insertion sort inversions', f: 'Insertion sort runs in Θ(n + I), where I is the number of inversions: Θ(n) on sorted input, Θ(n²) on reverse-sorted input.' },
  { s: 'Algorithms', k: 'merge sort space comparisons merge', f: 'Merge sort needs Θ(n) extra space for arrays; merging two sorted lists of sizes m and n takes at most m + n − 1 comparisons.' },
  { s: 'Algorithms', k: 'quick sort partition stable in place', f: 'Quicksort is in place (O(log n) expected stack) but not stable; its average case is Θ(n log n).' },
  { s: 'Algorithms', k: 'bellman ford iterations negative cycle', f: 'Bellman–Ford relaxes all edges V − 1 times (O(VE)); if any edge can still be relaxed after that, there is a negative cycle reachable from the source.' },
  { s: 'Algorithms', k: 'dijkstra complexity binary heap fibonacci', f: 'Dijkstra runs in O((V + E) log V) with a binary heap, O(E + V log V) with a Fibonacci heap, and O(V²) with an array.' },
  { s: 'Algorithms', k: 'kruskal complexity union find', f: 'Kruskal\'s algorithm runs in O(E log E) = O(E log V), dominated by sorting the edges, using union–find for cycle checks.' },
  { s: 'Algorithms', k: 'mst cut property cycle property', f: 'Cut property: the lightest edge crossing any cut is in some MST. Cycle property: the heaviest edge on any cycle (if unique) is in no MST.' },
  { s: 'Algorithms', k: '0 1 knapsack dp complexity pseudo polynomial', f: '0/1 knapsack DP runs in O(nW) time, which is pseudo-polynomial (polynomial in the value W, exponential in its bit length).' },
  { s: 'Algorithms', k: 'subset sum coin change dp', f: 'Subset sum and coin change are solved by DP in O(n × target) time; greedy coin change is optimal only for some coin systems (e.g. 1, 5, 10, 25).' },
  { s: 'Algorithms', k: 'bfs shortest path unweighted level', f: 'BFS from s visits vertices in order of their distance (number of edges) from s, so it gives shortest paths in unweighted graphs.' },
  { s: 'Algorithms', k: 'articulation point bridge dfs', f: 'Articulation points and bridges can be found with one DFS in O(V + E) using discovery times and low values.' },
  { s: 'Algorithms', k: 'growth order functions comparison', f: 'Growth order: 1 < log log n < log n < √n < n < n log n < n² < n³ < 2ⁿ < n! < nⁿ.' },

  // ---------- Theory of Computation ----------
  { s: 'Theory of Computation', k: 'nfa to dfa maximum states', f: 'Subset construction turns an n-state NFA into a DFA with at most 2ⁿ states, and some languages really need that many.' },
  { s: 'Theory of Computation', k: 'regular language strings length mod', f: 'Languages defined by counting modulo a number (e.g. number of a\'s divisible by 3) are regular; languages needing unbounded comparison (aⁿbⁿ, equal numbers of a and b) are not.' },
  { s: 'Theory of Computation', k: 'cfg ambiguity undecidable', f: 'Whether a context-free grammar is ambiguous is undecidable.' },
  { s: 'Theory of Computation', k: 'rice theorem non trivial property', f: 'Rice\'s theorem: every non-trivial property of the language recognised by a Turing machine is undecidable.' },
  { s: 'Theory of Computation', k: 'complement cfl not closed dcfl closed', f: 'The complement of a CFL need not be a CFL, but the complement of a DCFL is always a DCFL.' },
  { s: 'Theory of Computation', k: 'regular intersection cfl', f: 'The intersection of a context-free language with a regular language is context-free (and of a DCFL with a regular language is a DCFL).' },

  // ---------- Compiler Design ----------
  { s: 'Compiler Design', k: 'lr0 items slr follow reduce', f: 'An SLR(1) parser reduces by A → α only on lookaheads in FOLLOW(A); LR(0) reduces on every lookahead, which is why it has more conflicts.' },
  { s: 'Compiler Design', k: 'canonical lr1 lalr states number', f: 'LALR(1) has the same number of states as SLR(1)/LR(0); canonical LR(1) can have many more. Merging LR(1) states into LALR can add reduce–reduce conflicts but never new shift–reduce conflicts.' },
  { s: 'Compiler Design', k: 'operator precedence grammar', f: 'An operator grammar has no ε-productions and no two adjacent non-terminals on any right side.' },
  { s: 'Compiler Design', k: 'symbol table hashing', f: 'A symbol table stores identifiers with their attributes (type, scope, location) and is commonly implemented as a hash table.' },
  { s: 'Compiler Design', k: 'type checking semantic analysis', f: 'Type checking and checking that identifiers are declared before use happen in semantic analysis.' },

  // ---------- Databases ----------
  { s: 'Databases', k: 'dependency closure attribute closure algorithm', f: 'Attribute closure X⁺: start with X and repeatedly add the right side of any FD whose left side is contained in the current set; X is a superkey iff X⁺ contains all attributes.' },
  { s: 'Databases', k: 'lossless join binary decomposition test', f: 'A decomposition of R into R1 and R2 is lossless iff (R1 ∩ R2) → R1 or (R1 ∩ R2) → R2 holds.' },
  { s: 'Databases', k: 'bcnf dependency preservation 3nf guarantee', f: 'A lossless, dependency-preserving decomposition into 3NF always exists; BCNF decomposition is always lossless but may not preserve dependencies.' },
  { s: 'Databases', k: '2nf partial dependency 3nf transitive', f: '2NF forbids partial dependencies of non-prime attributes on a candidate key; 3NF additionally forbids transitive dependencies (for every X → A, X is a superkey or A is prime).' },
  { s: 'Databases', k: 'sql distinct count star', f: 'COUNT(*) counts all rows; COUNT(col) counts non-NULL values of col; COUNT(DISTINCT col) counts distinct non-NULL values.' },
  { s: 'Databases', k: 'sql exists correlated subquery', f: 'EXISTS (subquery) is true iff the subquery returns at least one row; a correlated subquery is re-evaluated for each row of the outer query.' },
  { s: 'Databases', k: 'sql union all intersect except duplicates', f: 'UNION, INTERSECT and EXCEPT remove duplicates; UNION ALL keeps them.' },
  { s: 'Databases', k: 'transaction states', f: 'Transaction states: active, partially committed, committed, failed, aborted.' },
  { s: 'Databases', k: 'log based recovery undo redo checkpoint', f: 'After a crash, transactions committed after the last checkpoint are redone and transactions without a commit record are undone (immediate-update logging).' },

  // ---------- Computer Networks ----------
  { s: 'Computer Networks', k: 'subnet mask host bits usable', f: 'A subnet with h host bits has 2ʰ addresses and 2ʰ − 2 usable host addresses (network and broadcast addresses excluded), for h ≥ 2.' },
  { s: 'Computer Networks', k: 'supernetting route aggregation longest prefix match', f: 'Routers forward using the longest prefix match: among matching routes, the one with the longest mask wins.' },
  { s: 'Computer Networks', k: 'sliding window sequence number bits go back n selective repeat', f: 'With n-bit sequence numbers, Go-Back-N allows a sender window of up to 2ⁿ − 1; Selective Repeat allows up to 2ⁿ⁻¹ (sender and receiver windows equal).' },
  { s: 'Computer Networks', k: 'sliding window utilization 1 + 2a', f: 'Sliding-window utilisation = min(1, W / (1 + 2a)) with a = Tp / Tt (W = window size in frames); stop-and-wait is W = 1.' },
  { s: 'Computer Networks', k: 'tcp header options window scaling', f: 'TCP\'s 16-bit window field allows at most 65,535 bytes unless the window-scale option is used; the TCP header is 20–60 bytes.' },
  { s: 'Computer Networks', k: 'nat port', f: 'NAT maps private (address, port) pairs to the router\'s public address with distinct ports, so many hosts can share one public IPv4 address.' },
  { s: 'Computer Networks', k: 'dns udp recursive iterative', f: 'DNS queries normally use UDP port 53 (TCP for zone transfers and large replies); a resolver may query recursively or iteratively.' },
  { s: 'Computer Networks', k: 'icmp ping traceroute', f: 'Ping uses ICMP echo request/reply; traceroute uses increasing TTL values and the resulting ICMP time-exceeded messages.' },

  // ---------- Discrete Mathematics ----------
  { s: 'Discrete Mathematics', k: 'number of relations antisymmetric asymmetric', f: 'On an n-element set: 2^(n²) relations; 2^(n(n−1)) reflexive; 2^(n(n+1)/2) symmetric; 2ⁿ·3^(n(n−1)/2) antisymmetric; 3^(n(n−1)/2) asymmetric.' },
  { s: 'Discrete Mathematics', k: 'number of graphs labeled simple', f: 'There are 2^(n(n−1)/2) labelled simple undirected graphs on n vertices.' },
  { s: 'Discrete Mathematics', k: 'tree edges vertices forest components', f: 'A tree with n vertices has n − 1 edges; a forest with n vertices and k components has n − k edges.' },
  { s: 'Discrete Mathematics', k: 'matching perfect independent set vertex cover konig', f: 'In any graph, |minimum vertex cover| + |maximum independent set| = n; in a bipartite graph, maximum matching = minimum vertex cover (Kőnig).' },
  { s: 'Discrete Mathematics', k: 'catalan number values', f: 'Catalan numbers Cₙ = C(2n, n)/(n + 1): 1, 1, 2, 5, 14, 42, 132, 429 for n = 0…7.' },
  { s: 'Discrete Mathematics', k: 'monoid semigroup closure associative', f: 'A semigroup is a set with a closed associative operation; a monoid adds an identity; a group adds inverses for every element.' },

  // ---------- Probability and Statistics / Linear Algebra / Calculus ----------
  { s: 'Probability and Statistics', k: 'pdf cdf continuous probability point', f: 'For a continuous random variable, P(X = a) = 0, the pdf integrates to 1, and the CDF F(x) = P(X ≤ x) is non-decreasing from 0 to 1.' },
  { s: 'Probability and Statistics', k: 'hypergeometric sampling without replacement', f: 'Drawing n items without replacement from N items of which K are special: P(k special) = C(K, k)·C(N − K, n − k) / C(N, n).' },
  { s: 'Linear Algebra', k: 'inverse 2x2 matrix adjoint', f: 'For A = [[a, b], [c, d]] with ad − bc ≠ 0, A⁻¹ = (1/(ad − bc))·[[d, −b], [−c, a]].' },
  { s: 'Linear Algebra', k: 'lu decomposition gaussian elimination', f: 'Gaussian elimination on an n×n system takes O(n³) operations; LU decomposition factors A = LU (with row exchanges if needed: PA = LU).' },
  { s: 'Calculus', k: 'fundamental theorem calculus definite integral', f: 'Fundamental theorem of calculus: if F′ = f, then ∫ₐᵇ f(x) dx = F(b) − F(a); and d/dx ∫ₐˣ f(t) dt = f(x).' },
  { s: 'Calculus', k: 'partial derivatives saddle second derivative test', f: 'For f(x, y) at a critical point, with D = f_xx·f_yy − f_xy²: D > 0 and f_xx > 0 → minimum; D > 0 and f_xx < 0 → maximum; D < 0 → saddle point.' },

  // ---------- General Aptitude ----------
  { s: 'General Aptitude', k: 'profit loss percentage cost price', f: 'Profit % = (selling price − cost price) / cost price × 100; a discount % is computed on the marked price.' },
  { s: 'General Aptitude', k: 'ratio proportion mixture alligation', f: 'Alligation: mixing two kinds priced c₁ < c₂ to get mean price m needs them in the ratio (c₂ − m) : (m − c₁).' },
  { s: 'General Aptitude', k: 'clock angle hands', f: 'The angle between the clock hands at h hours m minutes is |30h − 5.5m| degrees (take 360 minus it if it exceeds 180).' },
  { s: 'General Aptitude', k: 'calendar odd days leap year', f: 'A leap year is divisible by 4, except century years, which must be divisible by 400 (2000 was a leap year, 1900 was not).' },
);
