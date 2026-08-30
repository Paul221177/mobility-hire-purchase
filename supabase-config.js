(function () {
    const STORAGE_PREFIX = "mhp_";

    const defaultMotorcycles = [
        {
            id: 1,
            name: "Honda XR125",
            price: 425000,
            available: true,
            category: "Commuter"
        },
        {
            id: 2,
            name: "TVS Apache RTR 200",
            price: 780000,
            available: true,
            category: "Sport"
        },
        {
            id: 3,
            name: "Suzuki Giant Loop",
            price: 950000,
            available: true,
            category: "Utility"
        },
        {
            id: 4,
            name: "Yamaha R15M",
            price: 1320000,
            available: true,
            category: "Premium"
        }
    ];

    function safeStorage() {
        try {
            return window.localStorage;
        } catch (error) {
            return null;
        }
    }

    function readStorage(key, fallback) {
        const storage = safeStorage();

        if (!storage) {
            return fallback;
        }

        try {
            const value = storage.getItem(key);

            if (value === null || value === undefined) {
                return fallback;
            }

            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        const storage = safeStorage();

        if (!storage) {
            return;
        }

        storage.setItem(key, JSON.stringify(value));
    }

    function ensureSeedData() {
        const motorcycles = readStorage(STORAGE_PREFIX + "motorcycles", null);

        if (!Array.isArray(motorcycles) || motorcycles.length === 0) {
            writeStorage(STORAGE_PREFIX + "motorcycles", defaultMotorcycles);
        }

        const users = readStorage(STORAGE_PREFIX + "users", null);

        if (!Array.isArray(users)) {
            writeStorage(STORAGE_PREFIX + "users", []);
        }

        const applications = readStorage(STORAGE_PREFIX + "applications", null);

        if (!Array.isArray(applications)) {
            writeStorage(STORAGE_PREFIX + "applications", []);
        }
    }

    function getTableRows(tableName) {
        ensureSeedData();
        return readStorage(STORAGE_PREFIX + tableName, []);
    }

    function setTableRows(tableName, rows) {
        writeStorage(STORAGE_PREFIX + tableName, rows);
    }

    function normalizeUserRecord(user) {
        const payload = {
            id: user.id,
            first_name: user.first_name || user.firstName || "",
            last_name: user.last_name || user.lastName || "",
            email: user.email || "",
            phone: user.phone || "",
            address: user.address || "",
            business_name: user.business_name || user.business || "Mobility & Hire-Purchase Services",
            account_type: user.account_type || user.accountType || "Hire-Purchase",
            password: user.password || "",
            created_at: user.created_at || user.createdAt || new Date().toISOString(),
            user_metadata: {
                first_name: user.first_name || user.firstName || "",
                last_name: user.last_name || user.lastName || "",
                phone: user.phone || "",
                address: user.address || "",
                business_name: user.business_name || user.business || "Mobility & Hire-Purchase Services",
                account_type: user.account_type || user.accountType || "Hire-Purchase"
            }
        };

        if (user.full_name) {
            payload.full_name = user.full_name;
        }

        return payload;
    }

    function getUserById(userId) {
        const users = getTableRows("users");
        return users.find(user => String(user.id) === String(userId)) || null;
    }

    function getCurrentSessionUser() {
        const session = readStorage(STORAGE_PREFIX + "session", null);

        if (!session || !session.user_id) {
            return null;
        }

        return getUserById(session.user_id);
    }

    function toAuthUser(user) {
        const normalized = normalizeUserRecord(user);

        return {
            id: normalized.id,
            email: normalized.email,
            user_metadata: normalized.user_metadata
        };
    }

    function projectFields(item, fields) {
        if (!fields || fields === "*") {
            return item;
        }

        const columnList = (fields || "")
            .split(",")
            .map(column => column.trim())
            .filter(Boolean);

        if (columnList.length === 0) {
            return item;
        }

        return columnList.reduce((accumulator, column) => {
            accumulator[column] = item[column];
            return accumulator;
        }, {});
    }

    function matchesFilter(item, filter) {
        const value = item[filter.column];

        if (filter.type === "eq") {
            return String(value) === String(filter.value);
        }

        if (filter.type === "in") {
            return filter.value.includes(value);
        }

        return true;
    }

    function sortRows(items, orderBy) {
        if (!orderBy) {
            return items;
        }

        return [...items].sort((left, right) => {
            const leftValue = left[orderBy.column];
            const rightValue = right[orderBy.column];

            if (leftValue === rightValue) {
                return 0;
            }

            const result = leftValue > rightValue ? 1 : -1;

            return orderBy.ascending === false ? -result : result;
        });
    }

    async function runQuery(state) {
        const rows = getTableRows(state.tableName);

        const filteredRows = rows.filter(row =>
            state.filters.every(filter => matchesFilter(row, filter))
        );

        const orderedRows = sortRows(filteredRows, state.orderBy);
        const limitedRows = state.limitValue !== null
            ? orderedRows.slice(0, state.limitValue)
            : orderedRows;

        const selectedRows = state.selectFields === "*"
            ? limitedRows
            : limitedRows.map(row => projectFields(row, state.selectFields));

        if (state.maybeSingle) {
            return {
                data: selectedRows[0] || null,
                error: null
            };
        }

        return {
            data: selectedRows,
            error: null
        };
    }

    function createQueryBuilder(tableName) {
        const state = {
            tableName,
            filters: [],
            orderBy: null,
            limitValue: null,
            maybeSingle: false,
            selectFields: "*"
        };

        const builder = {
            select(fields) {
                state.selectFields = fields || "*";
                return builder;
            },
            eq(column, value) {
                state.filters.push({ type: "eq", column, value });
                return builder;
            },
            in(column, values) {
                const list = Array.isArray(values) ? values : [values];
                state.filters.push({ type: "in", column, value: list });
                return builder;
            },
            order(column, options = {}) {
                state.orderBy = {
                    column,
                    ascending: options.ascending !== false
                };
                return builder;
            },
            limit(value) {
                state.limitValue = Number(value);
                return builder;
            },
            maybeSingle() {
                state.maybeSingle = true;
                return builder;
            },
            insert(payload) {
                return Promise.resolve(insertRows(tableName, payload));
            },
            upsert(payload) {
                return Promise.resolve(upsertRows(tableName, payload));
            },
            then(resolve, reject) {
                return Promise.resolve(runQuery(state)).then(resolve, reject);
            },
            catch(reject) {
                return Promise.resolve(runQuery(state)).catch(reject);
            },
            finally(callback) {
                return Promise.resolve(runQuery(state)).finally(callback);
            }
        };

        return builder;
    }

    function upsertRows(tableName, payload) {
        const rows = getTableRows(tableName);
        const recordList = Array.isArray(payload) ? payload : [payload];

        recordList.forEach(record => {
            const key = record.id ?? record.user_id ?? record.application_id;
            const index = rows.findIndex(row => key !== undefined && String(row.id || row.user_id || row.application_id) === String(key));

            if (index >= 0) {
                rows[index] = {
                    ...rows[index],
                    ...record
                };
            } else {
                rows.push(record);
            }
        });

        setTableRows(tableName, rows);

        return {
            data: Array.isArray(payload) ? recordList : recordList[0],
            error: null
        };
    }

    function insertRows(tableName, payload) {
        const rows = getTableRows(tableName);
        const recordList = Array.isArray(payload) ? payload : [payload];

        rows.push(...recordList);
        setTableRows(tableName, rows);

        return {
            data: Array.isArray(payload) ? recordList : recordList[0],
            error: null
        };
    }

    const supabaseClient = {
        auth: {
            async getUser() {
                const user = getCurrentSessionUser();

                if (!user) {
                    return { data: { user: null }, error: null };
                }

                return {
                    data: { user: toAuthUser(user) },
                    error: null
                };
            },
            async signInWithPassword({ email, password }) {
                ensureSeedData();
                const users = getTableRows("users");
                const user = users.find(entry => {
                    const normalizedEmail = (entry.email || "").toLowerCase();
                    return normalizedEmail === String(email || "").trim().toLowerCase() && String(entry.password || "") === String(password || "");
                });

                if (!user) {
                    return {
                        data: { user: null },
                        error: { message: "Invalid login credentials." }
                    };
                }

                writeStorage(STORAGE_PREFIX + "session", { user_id: user.id, email: user.email });

                return {
                    data: { user: toAuthUser(user) },
                    error: null
                };
            },
            async signOut() {
                writeStorage(STORAGE_PREFIX + "session", null);
                return { error: null };
            }
        },
        from(tableName) {
            return createQueryBuilder(tableName);
        }
    };

    const builderFactory = {
        from(tableName) {
            return createQueryBuilder(tableName);
        }
    };

    if (typeof window !== "undefined") {
        window.supabaseClient = supabaseClient;
    }

    if (typeof globalThis !== "undefined") {
        globalThis.supabaseClient = supabaseClient;
        globalThis.supabase = { from: builderFactory.from };
    }
})();
