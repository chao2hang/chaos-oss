package handles

import (
	"context"
	"testing"

	_ "github.com/OpenListTeam/OpenList/v4/drivers"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func init() {
	dB, err := gorm.Open(sqlite.Open("file::memory:?cache=shared"), &gorm.Config{})
	if err != nil {
		panic("failed to connect database")
	}
	conf.Conf = conf.DefaultConfig("data")
	db.Init(dB)
}

func localStorage(mountPath string, disabled bool) *model.Storage {
	return &model.Storage{
		Driver:    "Local",
		MountPath: mountPath,
		Addition:  `{"root_folder_path":"."}`,
		Disabled:  disabled,
	}
}

func TestImportOneStorage(t *testing.T) {
	ctx := context.Background()

	// 1. fresh create
	res := importOneStorage(ctx, localStorage("/import-local", false), "skip")
	if res.Action != "created" || res.Error != "" {
		t.Fatalf("expected clean create, got %+v", res)
	}
	created, err := db.GetStorageByMountPath("/import-local")
	if err != nil {
		t.Fatalf("created storage not found in db: %+v", err)
	}
	if created.Disabled {
		t.Fatalf("storage should be enabled, got disabled")
	}
	if created.ID == 0 {
		t.Fatalf("storage id should be set")
	}

	// 2. same mount path, strategy=skip
	res = importOneStorage(ctx, localStorage("/import-local", false), "skip")
	if res.Action != "skipped" {
		t.Fatalf("expected skip, got %+v", res)
	}

	// 3. same mount path, strategy=overwrite updates in place
	updated := localStorage("/import-local", false)
	updated.Remark = "imported-remark"
	res = importOneStorage(ctx, updated, "overwrite")
	if res.Action != "updated" || res.Error != "" {
		t.Fatalf("expected clean update, got %+v", res)
	}
	after, err := db.GetStorageByMountPath("/import-local")
	if err != nil {
		t.Fatalf("updated storage not found: %+v", err)
	}
	if after.Remark != "imported-remark" {
		t.Fatalf("expected remark updated, got %q", after.Remark)
	}
	if after.ID != created.ID {
		t.Fatalf("update should keep the id: %d vs %d", after.ID, created.ID)
	}

	// 4. unknown driver fails without creating anything
	res = importOneStorage(ctx, &model.Storage{
		Driver: "NoSuchDriver", MountPath: "/import-none", Addition: `{}`,
	}, "skip")
	if res.Action != "failed" || res.Error == "" {
		t.Fatalf("expected failed import for unknown driver, got %+v", res)
	}
	if _, err := db.GetStorageByMountPath("/import-none"); err == nil {
		t.Fatalf("failed import must not create a storage")
	}

	// 5. missing mount path fails
	res = importOneStorage(ctx, &model.Storage{Driver: "Local", Addition: `{}`}, "skip")
	if res.Action != "failed" {
		t.Fatalf("expected failed import without mount path, got %+v", res)
	}

	// 6. disabled storage is created and persisted as disabled
	res = importOneStorage(ctx, localStorage("/import-disabled", true), "skip")
	if res.Action != "created" {
		t.Fatalf("expected create of disabled storage, got %+v", res)
	}
	disabled, err := db.GetStorageByMountPath("/import-disabled")
	if err != nil {
		t.Fatalf("disabled storage not found: %+v", err)
	}
	if !disabled.Disabled {
		t.Fatalf("storage should be persisted as disabled")
	}
	if op.HasStorage("/import-disabled") {
		t.Fatalf("disabled storage must not stay in the memory map")
	}

	// 7. unclean mount path is normalized before the existence check
	res = importOneStorage(ctx, localStorage("/import-local/", false), "skip")
	if res.Action != "skipped" || res.MountPath != "/import-local" {
		t.Fatalf("expected skip with normalized path, got %+v", res)
	}
}
