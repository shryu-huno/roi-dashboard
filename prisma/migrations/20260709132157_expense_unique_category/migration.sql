-- CreateIndex
CREATE UNIQUE INDEX "Expense_clientId_year_month_category_key" ON "Expense"("clientId", "year", "month", "category");
