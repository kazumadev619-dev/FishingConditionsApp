/*
  Warnings:

  - You are about to drop the `user_search_history` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "user_search_history" DROP CONSTRAINT "user_search_history_location_id_fkey";

-- DropForeignKey
ALTER TABLE "user_search_history" DROP CONSTRAINT "user_search_history_user_id_fkey";

-- DropTable
DROP TABLE "user_search_history";
