package handles

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/driver"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	pkgerrors "github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

type StorageResp struct {
	model.Storage
	MountDetails *model.StorageDetails `json:"mount_details,omitempty"`
}

type detailWithIndex struct {
	idx int
	val *model.StorageDetails
}

func makeStorageResp(ctx *gin.Context, storages []model.Storage) []*StorageResp {
	ret := make([]*StorageResp, len(storages))
	detailsChan := make(chan detailWithIndex, len(storages))
	workerCount := 0
	for i, s := range storages {
		ret[i] = &StorageResp{
			Storage:      s,
			MountDetails: nil,
		}
		if setting.GetBool(conf.HideStorageDetailsInManagePage) {
			continue
		}
		d, err := op.GetStorageByMountPath(s.MountPath)
		if err != nil {
			continue
		}
		_, ok := d.(driver.WithDetails)
		if !ok {
			continue
		}
		workerCount++
		go func(dri driver.Driver, idx int) {
			details, e := op.GetStorageDetails(ctx, dri)
			if e != nil {
				if !errors.Is(e, errs.NotImplement) && !errors.Is(e, errs.StorageNotInit) {
					log.Errorf("failed get %s details: %+v", dri.GetStorage().MountPath, e)
				}
			}
			detailsChan <- detailWithIndex{idx: idx, val: details}
		}(d, i)
	}
	for workerCount > 0 {
		select {
		case r := <-detailsChan:
			ret[r.idx].MountDetails = r.val
			workerCount--
		case <-time.After(time.Second * 3):
			workerCount = 0
		}
	}
	return ret
}

func ListStorages(c *gin.Context) {
	var req model.PageReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	req.Validate()
	log.Debugf("%+v", req)
	storages, total, err := db.GetStorages(req.Page, req.PerPage)
	if err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c, common.PageResp{
		Content: makeStorageResp(c, storages),
		Total:   total,
	})
}

func CreateStorage(c *gin.Context) {
	var req model.Storage
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if id, err := op.CreateStorage(c.Request.Context(), req); err != nil {
		common.ErrorWithDataResp(c, err, 500, gin.H{
			"id": id,
		}, true)
	} else {
		common.SuccessResp(c, gin.H{
			"id": id,
		})
	}
}

func UpdateStorage(c *gin.Context) {
	var req model.Storage
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := op.UpdateStorage(c.Request.Context(), req); err != nil {
		common.ErrorResp(c, err, 500, true)
	} else {
		common.SuccessResp(c)
	}
}

func DeleteStorage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := op.DeleteStorageById(c.Request.Context(), uint(id)); err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c)
}

func DisableStorage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := op.DisableStorage(c.Request.Context(), uint(id)); err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c)
}

func EnableStorage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := op.EnableStorage(c.Request.Context(), uint(id)); err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c)
}

func GetStorage(c *gin.Context) {
	idStr := c.Query("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	storage, err := db.GetStorageById(uint(id))
	if err != nil {
		common.ErrorResp(c, err, 500, true)
		return
	}
	common.SuccessResp(c, storage)
}

func LoadAllStorages(c *gin.Context) {
	storages, err := db.GetEnabledStorages()
	if err != nil {
		log.Errorf("failed get enabled storages: %+v", err)
		common.ErrorResp(c, err, 500, true)
		return
	}
	conf.ResetStoragesLoadSignal()
	go func(storages []model.Storage) {
		for _, storage := range storages {
			storageDriver, err := op.GetStorageByMountPath(storage.MountPath)
			if err != nil {
				log.Errorf("failed get storage driver: %+v", err)
				continue
			}
			// drop the storage in the driver
			if err := storageDriver.Drop(context.Background()); err != nil {
				log.Errorf("failed drop storage: %+v", err)
				continue
			}
			if err := op.LoadStorage(context.Background(), storage); err != nil {
				log.Errorf("failed get enabled storages: %+v", err)
				continue
			}
			log.Infof("success load storage: [%s], driver: [%s]",
				storage.MountPath, storage.Driver)
		}
		conf.SendStoragesLoadedSignal()
	}(storages)
	common.SuccessResp(c)
}

/* ---------------------- storage export / import ---------------------- */

// StorageExportVersion is the format version of the export payload.
const StorageExportVersion = 1

// StorageExportFile is the portable payload produced by ExportStorages and
// consumed by ImportStorages. It carries the full storage configuration
// (including driver credentials stored in Addition).
type StorageExportFile struct {
	Version    int             `json:"version"`
	ExportedAt time.Time       `json:"exported_at"`
	Storages   []model.Storage `json:"storages"`
}

// ImportStoragesReq is the request body of the import endpoint.
type ImportStoragesReq struct {
	Storages []model.Storage `json:"storages"`
	// Strategy when a storage with the same mount path already exists:
	//   "skip"      keep the existing storage (default)
	//   "overwrite" update it in place
	Strategy string `json:"strategy"`
}

// StorageImportResult reports what happened to a single imported storage.
// Action is one of: created / updated / skipped / failed.
type StorageImportResult struct {
	MountPath string `json:"mount_path"`
	Driver    string `json:"driver"`
	Action    string `json:"action"`
	// Error carries the reason of a failure, or a warning when the storage
	// was persisted but its driver failed to initialize.
	Error string `json:"error,omitempty"`
}

// StorageImportSummary aggregates the per-item import results.
type StorageImportSummary struct {
	Created int                   `json:"created"`
	Updated int                   `json:"updated"`
	Skipped int                   `json:"skipped"`
	Failed  int                   `json:"failed"`
	Results []StorageImportResult `json:"results"`
}

// ExportStorages returns the configuration of all (or a subset, via
// ?ids=1,2,3) storages as a portable JSON payload. Admin only — the payload
// contains driver credentials from the Addition field.
func ExportStorages(c *gin.Context) {
	var storages []model.Storage
	var err error
	idsStr := strings.TrimSpace(c.Query("ids"))
	if idsStr == "" {
		storages, err = db.GetAllStorages()
		if err != nil {
			common.ErrorResp(c, err, 500, true)
			return
		}
	} else {
		storages = make([]model.Storage, 0)
		for _, idStr := range strings.Split(idsStr, ",") {
			id, err := strconv.Atoi(strings.TrimSpace(idStr))
			if err != nil {
				common.ErrorStrResp(c, "invalid storage id: "+strings.TrimSpace(idStr), 400)
				return
			}
			storage, err := db.GetStorageById(uint(id))
			if err != nil {
				common.ErrorResp(c, err, 500, true)
				return
			}
			storages = append(storages, *storage)
		}
	}
	// strip runtime fields so the payload only carries configuration
	for i := range storages {
		storages[i].ID = 0
		storages[i].Status = ""
		storages[i].Modified = time.Time{}
	}
	common.SuccessResp(c, &StorageExportFile{
		Version:    StorageExportVersion,
		ExportedAt: time.Now(),
		Storages:   storages,
	})
}

// ImportStorages creates or updates storages from a payload previously
// produced by ExportStorages. Each storage is processed independently, so
// one bad entry does not abort the whole import.
func ImportStorages(c *gin.Context) {
	var req ImportStoragesReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	switch req.Strategy {
	case "":
		req.Strategy = "skip"
	case "skip", "overwrite":
	default:
		common.ErrorStrResp(c, "strategy must be skip or overwrite", 400)
		return
	}
	if len(req.Storages) == 0 {
		common.ErrorStrResp(c, "no storages in the import payload", 400)
		return
	}
	summary := &StorageImportSummary{Results: make([]StorageImportResult, 0, len(req.Storages))}
	for i := range req.Storages {
		summary.Results = append(summary.Results, importOneStorage(c.Request.Context(), &req.Storages[i], req.Strategy))
	}
	for _, r := range summary.Results {
		switch r.Action {
		case "created":
			summary.Created++
		case "updated":
			summary.Updated++
		case "skipped":
			summary.Skipped++
		default:
			summary.Failed++
		}
	}
	common.SuccessResp(c, summary)
}

// importOneStorage imports a single storage and reports the outcome.
func importOneStorage(ctx context.Context, storage *model.Storage, strategy string) StorageImportResult {
	// normalize volatile fields coming from the (possibly foreign) export
	storage.ID = 0
	storage.Status = ""
	storage.Modified = time.Time{}
	res := StorageImportResult{
		MountPath: storage.MountPath,
		Driver:    storage.Driver,
	}
	fail := func(err error) StorageImportResult {
		res.Action = "failed"
		res.Error = err.Error()
		return res
	}
	if storage.MountPath == "" {
		return fail(errors.New("mount_path is required"))
	}
	if storage.Driver == "" {
		return fail(errors.New("driver is required"))
	}
	if _, err := op.GetDriver(storage.Driver); err != nil {
		return fail(err)
	}
	// normalize the same way op.CreateStorage / op.UpdateStorage do, so the
	// existence check below matches what will actually be written
	storage.MountPath = utils.FixAndCleanPath(storage.MountPath)
	res.MountPath = storage.MountPath
	existing, err := db.GetStorageByMountPath(storage.MountPath)
	if err == nil && existing != nil {
		// mount path taken
		if strategy == "skip" {
			res.Action = "skipped"
			return res
		}
		if existing.Driver != storage.Driver {
			return fail(pkgerrors.Errorf("mount path %s is already used by driver %s, changing the driver is not supported",
				storage.MountPath, existing.Driver))
		}
		return updateImportedStorage(ctx, storage, existing, res)
	}
	// create new storage. op.DisableStorage refuses to run on a storage
	// that is already stored as disabled, so create it enabled first and
	// drop it afterwards when the import says it should be disabled.
	importedDisabled := storage.Disabled
	storage.Disabled = false
	id, err := op.CreateStorage(ctx, *storage)
	if id > 0 {
		// the storage was persisted even if the driver failed to init
		storage.ID = id
		res.Action = "created"
		if err != nil {
			res.Error = "created but driver init failed: " + err.Error()
		}
		if importedDisabled {
			if e := op.DisableStorage(ctx, id); e != nil {
				warn := "created but disabling it failed: " + e.Error()
				if res.Error == "" {
					res.Error = warn
				}
			}
		}
		return res
	}
	return fail(err)
}

// updateImportedStorage overwrites an existing storage in place.
func updateImportedStorage(ctx context.Context, storage *model.Storage, existing *model.Storage, res StorageImportResult) StorageImportResult {
	wasDisabled := existing.Disabled
	// update with the current enabled/disabled state first so the driver
	// lifecycle stays consistent, then flip the flag if the import changes it
	importedDisabled := storage.Disabled
	storage.ID = existing.ID
	storage.Disabled = wasDisabled
	err := op.UpdateStorage(ctx, *storage)
	if err != nil {
		// the config may still have been persisted (init failure)
		if strings.HasPrefix(err.Error(), "driver cannot be changed") ||
			strings.HasPrefix(err.Error(), "failed update storage in database") ||
			strings.HasPrefix(err.Error(), "failed get old storage") {
			res.Action = "failed"
			res.Error = err.Error()
			return res
		}
		res.Action = "updated"
		res.Error = "updated but driver init failed: " + err.Error()
		return res
	}
	res.Action = "updated"
	if importedDisabled != wasDisabled {
		var flipErr error
		if importedDisabled {
			flipErr = op.DisableStorage(ctx, existing.ID)
		} else {
			flipErr = op.EnableStorage(ctx, existing.ID)
		}
		if flipErr != nil {
			res.Error = "updated but changing enabled state failed: " + flipErr.Error()
		}
	}
	return res
}
